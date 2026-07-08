#!/usr/bin/env node
// Minimal OAuth 2.1 + PKCE proxy in front of supergateway.
// Handles /.well-known/oauth-authorization-server + /oauth/* endpoints.
// Proxies everything else to supergateway on MCP_PORT.
//
// Claude mobile / Claude.ai web enforce RFC 8414 OAuth discovery before
// accepting a custom MCP server. This proxy auto-approves every
// authorization — actual access control is the secret URL path segment.

import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'

const PORT     = parseInt(process.env.OAUTH_PORT ?? '4321')
const MCP_PORT = parseInt(process.env.MCP_PORT   ?? '4322')
const BASE_URL = process.env.BASE_URL ?? 'https://obs-mcp.yourdomain.com'

const pendingCodes = new Map()
const validTokens  = new Set()

function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', c => buf += c)
    req.on('end', () => {
      try {
        resolve(req.headers['content-type']?.includes('application/x-www-form-urlencoded')
          ? Object.fromEntries(new URLSearchParams(buf))
          : JSON.parse(buf || '{}'))
      } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function proxyToMcp(req, res) {
  const opts = {
    hostname: '127.0.0.1', port: MCP_PORT, path: req.url,
    method: req.method, headers: { ...req.headers, host: `localhost:${MCP_PORT}` },
  }
  const proxy = http.request(opts, up => { res.writeHead(up.statusCode, up.headers); up.pipe(res) })
  proxy.on('error', err => {
    if (!res.headersSent) sendJson(res, 502, { error: 'mcp_unreachable', detail: err.message })
    else res.destroy()
  })
  req.pipe(proxy)
}

http.createServer(async (req, res) => {
  const url  = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  if (req.method === 'GET' && path === '/.well-known/oauth-authorization-server') {
    return sendJson(res, 200, {
      issuer: BASE_URL,
      authorization_endpoint: `${BASE_URL}/oauth/authorize`,
      token_endpoint: `${BASE_URL}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp'],
    })
  }

  if (req.method === 'GET' && path === '/oauth/authorize') {
    const redirectUri   = url.searchParams.get('redirect_uri')
    const state         = url.searchParams.get('state')
    const codeChallenge = url.searchParams.get('code_challenge')
    if (!redirectUri) return sendJson(res, 400, { error: 'invalid_request' })
    const code = crypto.randomBytes(20).toString('hex')
    pendingCodes.set(code, { redirectUri, codeChallenge, expires: Date.now() + 600_000 })
    const redirect = new URL(redirectUri)
    redirect.searchParams.set('code', code)
    if (state) redirect.searchParams.set('state', state)
    res.writeHead(302, { Location: redirect.toString() })
    return res.end()
  }

  if (req.method === 'POST' && path === '/oauth/token') {
    const { grant_type, code, code_verifier } = await parseBody(req)
    if (grant_type !== 'authorization_code') return sendJson(res, 400, { error: 'unsupported_grant_type' })
    const stored = pendingCodes.get(code)
    if (!stored || Date.now() > stored.expires) return sendJson(res, 400, { error: 'invalid_grant' })
    if (stored.codeChallenge) {
      if (!code_verifier) return sendJson(res, 400, { error: 'invalid_grant' })
      const hash = crypto.createHash('sha256').update(code_verifier).digest('base64url')
      if (hash !== stored.codeChallenge) return sendJson(res, 400, { error: 'invalid_grant' })
    }
    pendingCodes.delete(code)
    const token = crypto.randomBytes(32).toString('hex')
    validTokens.add(token)
    return sendJson(res, 200, { access_token: token, token_type: 'bearer', expires_in: 31_536_000, scope: 'mcp' })
  }

  // GET on the MCP path → SSE keepalive stream (Claude mobile opens this for server-push)
  if (req.method === 'GET' && path.endsWith('/mcp')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
    res.write(': connected\n\n')
    const ping = setInterval(() => { if (res.destroyed) return clearInterval(ping); res.write(': ping\n\n') }, 25_000)
    req.on('close', () => clearInterval(ping))
    return
  }

  proxyToMcp(req, res)
}).listen(PORT, '0.0.0.0', () => console.log(`[obs-oauth-proxy] :${PORT} → MCP :${MCP_PORT}`))
