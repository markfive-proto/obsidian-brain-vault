# Brain Vault — a knowledge base that writes itself

<p align="center">
  <img src="./docs/images/hero-knowledge-tree.png" alt="A luminous knowledge tree growing from a terminal cursor — the Brain Vault knowledge base" width="85%" />
</p>

<p align="center">
  <code>obsidian-brain-vault</code> · CLI: <code>obs</code> · MCP: <code>obs-mcp</code>
</p>

The free, community-built implementation of Andrej Karpathy's [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): drop raw sources in, an LLM compiles them into an interlinked wiki, answers you save compound over time. Built to give AI agents persistent context that goes beyond a single chat session.

**AI-first. Headless. MCP-ready.** Works with Claude Desktop, Cursor, Windsurf, Claude Code. Any markdown folder — Obsidian-compatible today, vendor-neutral by design.

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![free](https://img.shields.io/badge/free-forever-22c55e)](LICENSE) [![cli + mcp](https://img.shields.io/badge/CLI%20%2B%20MCP-ready-06b6d4)](./README.md#connect-it-to-claude-desktop--cursor--windsurf-mcp)

---

## The problem

Every AI chat starts from zero. You re-explain who you are, what you're building, what you already know. The session ends and your best thinking disappears.

Meanwhile you have 20 browser tabs you meant to read, a folder of PDFs you never opened, and 500 notes that never link to each other. RAG retrieves the same chunks forever — nothing accumulates. Note apps are graveyards you have to maintain yourself.

Your AI agents need **persistent, compounding context**. That's what `obs` gives them.

---

## The KB loop

```
RAW sources  →  obs kb ingest  →  raw/
raw/          →  obs kb compile →  compiled/ concept pages
compiled/     →  obs kb ask     →  outputs/ answers (filed back as new context)
```

Every ingest adds to the wiki. Every answer becomes part of the next answer. Source #50 links to ~10 existing pages and updates them — it doesn't sit alone.

```bash
obs kb ingest https://example.com/article   # fetch + file to raw/
obs kb compile                              # LLM compiles raw/ → concept pages
obs kb ask "what do I know about X?"        # query + save to outputs/
```

<p align="center">
  <img src="./docs/images/karpathy-loop.png" alt="The Karpathy loop: RAW sources → COMPILED wiki → OUTPUTS, with outputs filing back into raw" width="90%" />
</p>

---

## What `obs` gives you

- **A wiki that compounds.** Drop a URL, PDF, repo, transcript, or image. The LLM extracts concepts, cross-references everything you already have, and files it.
- **Answers that stick.** Ask a question. The answer is saved as a new note with wikilinks. Next question uses it as context.
- **A built-in MCP server.** Plug into Claude Desktop, Cursor, Windsurf, Claude Code. Your agents query the wiki natively — no copy-pasting context.
- **Remote MCP hosting.** Expose your vault over HTTPS so Claude.ai, mobile clients, or any AI tool can reach it from anywhere.
- **Headless by design.** Runs on a server, in CI, in a cron job. Obsidian doesn't need to be open.
- **A Unix tool.** Pipeable, scriptable, `--json` on every command. Compose it with anything.
- **Three ways to use it.** CLI for scripts and automation. Claude Code slash commands (`/clip`, `/compile`, `/ask`, `/lint`) for conversational use. Claude Desktop MCP prompts for team workflows — all three speak the same underlying vault.
- **AutoDream.** A nightly `compile → lint → stats` job that keeps your wiki fresh while you sleep. One script, works on macOS (launchd) and Linux (cron).
- **Ready-to-use scaffold.** The [`knowledgebase/`](./knowledgebase/) folder in this repo is a drop-in template — pre-structured `raw/`, `compiled/`, `outputs/`, `skills/` (all packs included), with AutoDream tools. See [`knowledgebase/README-KB.md`](./knowledgebase/README-KB.md) for the quickstart.

---

## Why `obs` — and how it differs from Obsidian's official CLI

Obsidian shipped their own [official CLI](https://obsidian.md/cli) in early 2026 (now free). It's excellent at what it does: remote-controlling the Obsidian app, triggering plugins, deploying vaults, integrating Obsidian into team toolchains. It requires Obsidian to be running.

`obs` is a different category of tool:

| | Official Obsidian CLI | `obs` (this project) |
|---|---|---|
| Requires Obsidian running | Yes | No — fully headless |
| LLM knowledge compilation | No | Yes — the core feature |
| `ingest → compile → ask` loop | No | Yes |
| Built-in MCP server | No | Yes (`obs-mcp`) |
| Remote MCP (HTTPS, mobile) | No | Yes (supergateway + cloudflared) |
| Claude Code skill pack | No | Yes |
| Works on a server / in CI | No | Yes |
| Vendor-neutral (no Obsidian dep) | No | Yes |
| Vault ops (tags, links, search…) | Via Obsidian's API | Direct file I/O, no app needed |

If you want to script Obsidian's UI — use their CLI. If you want an AI agent knowledge base that runs anywhere and accumulates context over time — that's `obs`.

---

## 2-minute quickstart

### Option A — Use the scaffold (recommended)

Clone this repo and copy the pre-built scaffold into your Obsidian vault:

```bash
git clone https://github.com/markfive-proto/obsidian-brain-vault.git
cp -r obsidian-brain-vault/knowledgebase /path/to/your/vault/
```

Then open [`knowledgebase/README-KB.md`](./knowledgebase/README-KB.md) — it's the complete quickstart from inside the vault.

### Option B — Fresh install

### 1. Install

```bash
# Requires Node 18+
pnpm add -g obsidian-brain-vault          # or: npm i -g obsidian-brain-vault

# Verify
obs --version
```

### 2. Point `obs` at your vault

```bash
obs init                                 # Auto-detects Obsidian vaults
# or
obs vault config defaultVault /path/to/vault
```

### 3. Start the loop

```bash
obs kb init                              # Scaffold raw/ compiled/ outputs/

obs kb ingest https://karpathy.ai/...    # Add a source
obs kb compile                           # Fold it into the wiki
obs kb ask "what does my KB say about X?" # Query — answer saved to outputs/

obs kb stats                             # See the shape of your KB
```

You now have a vault structured like this:

```
your-vault/
├── raw/              sources you ingested (immutable)
│   ├── articles/
│   ├── papers/
│   ├── repos/
│   └── INGEST-LOG.md
├── compiled/         LLM-written wiki
│   ├── 00-INDEX.md
│   ├── concepts/     cross-referenced concept pages
│   ├── people/
│   └── orgs/
└── outputs/          answers, slides, charts, lint reports
    ├── answers/
    ├── slides/
    └── lint/
```

Open the vault in Obsidian — everything is plain markdown with `[[wikilinks]]`.

---

## Three ways to use the KB loop

There are three interfaces to the same underlying vault — pick the one that fits your workflow:

| Interface | Best for | How |
|---|---|---|
| **CLI** | Scripts, automation, headless runs | `obs kb ingest / compile / ask / lint` |
| **Claude Code skills** | Conversational coding sessions | `/clip`, `/compile`, `/ask`, `/lint` slash commands |
| **Claude Desktop prompts** | Team workflows, Claude.ai, mobile | MCP prompt picker — select prompt, fill args |

All three write to the same vault. The wiki you build with the CLI is queryable via Claude Desktop and vice versa.

---

## Use it with Claude Code

`obs` ships with a Claude Code skill pack. Every `obs kb` CLI command has a slash-command twin you can invoke in Claude Code conversations.

### Install the skill pack

```bash
# Clone and link if you haven't already
git clone https://github.com/markfive-proto/obsidian-brain-vault.git
cd obsidian-brain-vault && pnpm install && pnpm build && pnpm link --global

# Install a pack globally (available in all Claude Code projects)
obs skills install knowledge-base          # The Karpathy pack (ingest/compile/qa/lint/render)
obs skills install capture                 # Brain-dump + quick-capture cognitive pack

# Or install to the current project only
obs skills install knowledge-base --local
```

### Available slash commands

Once installed, in any Claude Code session:

| You type | Claude does |
|---|---|
| `/clip <url>` | Fetches the page, cleans it to markdown, files it in `raw/articles/` |
| `/paper <arxiv-or-pdf>` | Extracts text + figures from a PDF into `raw/papers/` |
| `/repo <github-url>` | Fetches README + key files into `raw/repos/` |
| `/transcript <youtube-url>` | Pulls auto-captions into `raw/transcripts/` |
| `/compile` | Scans raw/ for new sources, generates/updates concept pages |
| `/ask <question>` | Queries the wiki, saves the answer to `outputs/answers/` |
| `/deep <topic>` | Multi-step research dive across the wiki |
| `/lint` | Finds broken links, orphans, missing frontmatter, gaps |
| `/slides <topic>` | Renders a Marp slide deck |
| `/brief <topic>` | Renders a 1-page executive brief |
| `/chart <dataset>` | Renders a matplotlib chart |

---

## Connect it to Claude Desktop / Cursor / Windsurf (MCP)

`obs` includes a built-in [MCP](https://modelcontextprotocol.io) server (`obs-mcp`) so any AI tool that speaks MCP can use your vault as a tool.

### One-command setup (recommended)

```bash
obs setup --vault /absolute/path/to/your/vault
```

This auto-detects every AI editor you have installed (Claude Desktop, Claude Code, Cursor, Windsurf, Codex, OpenCode) and patches each config in one shot. Preview what it will do first:

```bash
obs setup --dry-run --vault /absolute/path/to/your/vault
```

Restart any editors that were patched. You'll see an 🔨 icon (Claude Desktop) or equivalent — click it to confirm `obs_*` tools are listed.

### Manual setup (if you prefer)

<details>
<summary>Claude Desktop</summary>

```bash
# macOS
open ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Windows
notepad %APPDATA%\Claude\claude_desktop_config.json
```

Add to `mcpServers`:

```json
{
  "mcpServers": {
    "obs": {
      "command": "obs-mcp",
      "args": ["--vault", "/absolute/path/to/your/vault"]
    }
  }
}
```

Restart Claude Desktop.
</details>

<details>
<summary>Cursor</summary>

Add to `~/.cursor/mcp.json` (or **Settings → MCP → Add Server**):

```json
{
  "mcpServers": {
    "obs": {
      "command": "obs-mcp",
      "args": ["--vault", "/absolute/path/to/your/vault"]
    }
  }
}
```
</details>

<details>
<summary>Windsurf</summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "obs": {
      "command": "obs-mcp",
      "args": ["--vault", "/absolute/path/to/your/vault"]
    }
  }
}
```
</details>

<details>
<summary>Claude Code (CLI)</summary>

```bash
claude mcp add obs obs-mcp --vault /absolute/path/to/your/vault
```
</details>

---

## Remote MCP — expose your vault to Claude.ai, mobile, or any HTTP client

By default `obs-mcp` speaks stdio — it only works on the same machine. To use your vault from **Claude.ai web chat**, a second device, or any tool that only supports HTTP MCP, you need three layers:

| Layer | What it does |
|---|---|
| **supergateway** (streamableHttp mode) | Wraps `obs-mcp` stdio as an HTTP MCP endpoint |
| **OAuth proxy** | Serves OAuth 2.1 + PKCE discovery so Claude mobile / web will accept the server |
| **Cloudflare Tunnel** | Exposes localhost over HTTPS with zero port-forwarding |

> **Why streamableHttp and not SSE?**
> SSE keeps a single long-lived connection per client. When a reverse proxy or the client reconnects, `supergateway` tries to call `connect()` on the same internal MCP instance and crashes. `streamableHttp` spawns a fresh stdio process for every POST — no persistent connection, no crash loop, no buffering issues.

> **Why OAuth?**
> Claude mobile and Claude.ai web enforce RFC 8414 OAuth 2.1 discovery (`/.well-known/oauth-authorization-server`) before accepting any custom MCP server. Without it the server is silently rejected. The proxy auto-approves every authorization — actual security comes from keeping the endpoint URL private.

### 1. Install dependencies

```bash
npm i -g supergateway
# Node 18+ built-ins only needed for the OAuth proxy — no extra packages
```

### 2. Create the OAuth proxy

Save the following as `~/bin/obs-oauth-proxy.mjs` (no npm dependencies — uses Node built-ins only):

```js
#!/usr/bin/env node
// Minimal OAuth 2.1 + PKCE proxy in front of supergateway.
// Handles /.well-known/oauth-authorization-server + /oauth/* endpoints.
// Proxies everything else to supergateway on MCP_PORT.

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
```

### 3. Create the gateway launch script

Save as `~/bin/run-obs-gateway.sh`:

```bash
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

VAULT="/absolute/path/to/your/vault"
NODE="$(which node)"
SUPERGATEWAY="$(npm root -g)/supergateway/dist/index.js"
OBS_MCP="$(npm root -g)/obsidian-brain-vault/dist/mcp/server.js"

# Pick a secret path segment — this is your only access control
# Generate one: openssl rand -hex 16
SECRET_PATH="your-secret-path-here"

# supergateway on internal port (streamableHttp, not SSE)
"$NODE" "$SUPERGATEWAY" \
  --stdio "$NODE $OBS_MCP --vault $VAULT" \
  --outputTransport streamableHttp \
  --streamableHttpPath "/${SECRET_PATH}/mcp" \
  --port 4322 &

# OAuth proxy on external port (facing the reverse proxy / tunnel)
BASE_URL="https://obs-mcp.yourdomain.com" \
OAUTH_PORT=4321 \
MCP_PORT=4322 \
exec "$NODE" ~/bin/obs-oauth-proxy.mjs
```

```bash
chmod +x ~/bin/run-obs-gateway.sh
```

Keep it alive with a LaunchAgent (macOS) — set `ProgramArguments` to `["bash", "/Users/you/bin/run-obs-gateway.sh"]`, `RunAtLoad: true`, `KeepAlive: true`.

### 4. Expose it with Cloudflare Tunnel

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create obs-mcp
cloudflared tunnel route dns obs-mcp obs-mcp.yourdomain.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: ~/.cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: obs-mcp.yourdomain.com
    service: http://localhost:4321
    originRequest:
      http2Origin: false
      noTLSVerify: true
      connectTimeout: 30s
      tcpKeepAlive: 30s
  - service: http_status:404
```

```bash
cloudflared tunnel run obs-mcp
```

### 5. Connect any remote client

Replace `obs-mcp.yourdomain.com` and `your-secret-path-here` with your actual values.

**Claude Desktop** (Mac / Windows — stdio only, needs `mcp-remote` bridge):

```json
{
  "mcpServers": {
    "obs-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://obs-mcp.yourdomain.com/your-secret-path-here/mcp"]
    }
  }
}
```

First launch takes 10–20 s while `npx` fetches `mcp-remote` and completes the OAuth flow. After that the token is cached and it's instant.

**Claude.ai web → Settings → Integrations → Add MCP Server:**
```
https://obs-mcp.yourdomain.com/your-secret-path-here/mcp
```

**Claude Code:**
```bash
claude mcp add obs-remote --url https://obs-mcp.yourdomain.com/your-secret-path-here/mcp
```

**Cursor / Windsurf** (same `mcp-remote` bridge as Claude Desktop):
```json
{
  "mcpServers": {
    "obs-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://obs-mcp.yourdomain.com/your-secret-path-here/mcp"]
    }
  }
}
```

---

### What the AI can now do

**21 MCP tools** (15 vault ops + 6 KB ops) + **6 MCP prompts** for Claude Desktop:

**KB tools:** `obs_kb_init`, `obs_kb_stats`, `obs_kb_list_raw`, `obs_kb_list_concepts`, `obs_kb_list_outputs`, `obs_kb_append_ingest_log`

**Vault tools:** `obs_vault_info`, `obs_read_note`, `obs_write_note`, `obs_create_note`, `obs_search`, `obs_list_files`, `obs_manage_tags`, `obs_manage_properties`, `obs_daily_note`, `obs_list_links`, `obs_list_files_filtered`, `obs_links_path`, `obs_links_orphans`, `obs_vault_wordcount`

**MCP prompts (Claude Desktop slash commands):**

| Prompt | What you say | What it does |
|---|---|---|
| `clip` | "Use the clip prompt with https://..." | Ingest a URL / PDF / repo / transcript |
| `compile` | "Run the compile prompt" | Fold raw sources into the wiki |
| `ask` | "Use the ask prompt: what do I know about X?" | Query + save answer to outputs/ |
| `lint` | "Run the lint prompt" | Health check: broken links, orphans, gaps |
| `render` | "Use the render prompt, format=slides, topic=X" | Generate a Marp deck, brief, or chart |
| `dream` | "Run the dream prompt" | Full compile + lint + stats cycle |

In Claude Desktop you'll find these in the **prompt picker** (the `+` button). Select a prompt, fill in the argument, and the skill runs — no manual copy-pasting.

Ask any connected AI: *"Show me my KB stats and list 5 concept pages."* It will call the MCP tools, no prompting needed.

---

## Commands cheatsheet

The KB loop:

```bash
obs kb init                              # Scaffold raw/ compiled/ outputs/
obs kb ingest <url|file>                 # Add a source
obs kb compile                           # raw/ → compiled/ concept pages
obs kb ask "question"                    # Query, save answer
obs kb lint                              # Broken links / orphans / gaps
obs kb stats                             # Health summary
obs kb list raw|concepts|outputs         # Browse
```

The roadmap uniques (Phase 3 — nobody has shipped these):

```bash
obs kb verify <concept>                  # Fact-check claims against cited sources
obs kb eval                              # Self-test wiki IQ, track accuracy over time
obs kb autohunt                          # Overnight research daemon for open questions
obs kb publish <concept> --format blog   # Blog / tweet / newsletter / LinkedIn post
obs kb watch                             # Auto-recompile on raw/ change [phase 2]
```

AutoDream — nightly background compilation:

```bash
bash knowledgebase/tools/setup-dream.sh --vault /path/to/vault   # install
bash knowledgebase/tools/dream.sh --dry-run                       # preview
VAULT=/path/to/vault bash knowledgebase/tools/dream.sh            # run now
```

Headless vault ops (work without Obsidian open):

```bash
obs vault info                           # Vault name, stats, plugins
obs files list --since 7d                # Files modified in last 7 days
obs search content "TODO"                # Full-text search
obs tags all --sort count                # Tag frequency
obs links broken                         # Dead wikilinks
obs links orphans                        # Unlinked notes
obs daily create                         # Today's daily note
obs tasks pending --json | jq            # All unchecked tasks
```

Every command supports `--json` for scripting and `--help` for details. See [`docs/commands.md`](./docs/commands.md) or run `obs --help` for the full reference.

---

## Cognitive skill packs

Beyond the knowledge-base pack, `obs` ships six cognitive skill packs that turn Claude Code into a thinking partner:

| Pack | Slash commands | What it does |
|---|---|---|
| **knowledge-base** | `/clip`, `/paper`, `/compile`, `/ask`, `/lint`, `/slides`, `/brief`, … | Karpathy LLM-Wiki workflow |
| **capture** | `/dump`, `/capture`, `/quick` | Brain dumps, rapid-fire capture |
| **clarify** | `/articulate`, `/expand`, `/simplify` | Rewrite messy notes, distill to core |
| **connect** | `/connect`, `/trace`, `/drift` | Find hidden connections, track evolution |
| **reflect** | `/emerge`, `/challenge`, `/growth` | Cluster ideas, challenge assumptions |
| **act** | `/next`, `/decide`, `/graduate` | Priorities, decisions, promote ideas |
| **review** | `/today`, `/closeday`, `/weekly` | Daily and weekly rituals |

```bash
obs skills list                           # Browse all packs
obs skills info knowledge-base            # See a pack's commands
obs skills install knowledge-base         # Install globally
obs skills install knowledge-base --local # Install to current project
```

---

## Roadmap

**Phase 1 — shipped:**
- `obs kb init / stats / list` (native)
- `obs kb ingest / compile / ask / lint / render / verify / eval / autohunt` (stubs that delegate to Claude Code skills; full logic in the skills today)
- 21 MCP tools (15 vault ops + 6 KB ops)
- 6 MCP prompts for Claude Desktop (clip, compile, ask, lint, render, dream)
- Claude Code skill pack (ingest, compile, qa, lint, render) in `knowledgebase/skills/`
- AutoDream nightly daemon (`knowledgebase/tools/`)

**Phase 2 — next:**
- Native LLM-backed `ingest / compile / ask / lint` via LiteLLM or Anthropic SDK
- SHA-256 change detection for incremental compile
- markitdown / pdftotext ingest for PDF, docx, pptx
- `obs kb watch` daemon
- MCP tools for all LLM-backed ops

**Phase 3 — the uniques:**
- `obs kb verify <concept>` — fact-check each claim on a concept page against its cited sources; annotate hallucinations with `[!unverified]` callouts
- `obs kb eval` — generate held-out Q&A from sources, measure the wiki's answer accuracy, write a weekly IQ trend
- `obs kb autohunt` — overnight research loop that collects open questions from concept pages, hunts for sources, recompiles, writes a morning digest
- `obs kb publish` — render a concept or answer as a blog draft, tweet thread, newsletter, or LinkedIn post

These three are the defensible wedge; nobody in the LLM-Wiki space has shipped them.

---

## JSON mode & scripting

All commands support `--json`:

```bash
obs vault stats --json | jq '.fileCount'
obs tasks pending --json | jq -r '.[] | [.file, .line, .text] | @csv'
obs kb stats --json | jq '.danglingWikilinks'
obs kb list concepts --json | jq -r '.[]'
```

---

## Global options

| Flag | Description |
|---|---|
| `--vault <path>` | Override the configured vault |
| `--json` | Machine-readable output |
| `--help` | Help for any command |
| `--version` | Print CLI version |

---

## Development

```bash
git clone https://github.com/markfive-proto/obsidian-brain-vault.git
cd obsidian-brain-vault
pnpm install
pnpm build             # production build
pnpm dev               # watch mode
pnpm test              # vitest (67 tests currently)
pnpm link --global     # expose `obs` and `obs-mcp` binaries
```

Code layout:

```
src/
├── index.ts           CLI entrypoint (commander)
├── commands/          one file per command group (kb, files, search, tags, ...)
├── mcp/               MCP server + tool registration
├── utils/             frontmatter, markdown, output helpers
└── vault.ts           Vault class — direct file I/O, safe path resolution

skills/                Claude Code skill packs (one folder per skill)
├── knowledge-base/    (via the 5 subfolders: ingest, compile, qa, lint, render)
├── capture/ clarify/ connect/ reflect/ act/ review/
└── obs/               CLI reference skill
```

---

## Contributing

PRs welcome — especially:

- Phase 2 native implementations (look at `src/commands/kb.ts` — the stubs mark their intent with `printStub(...)`)
- Phase 3 features (`verify`, `eval`, `autohunt`)
- More ingest formats (epub, mhtml, rss)
- More render formats (Mermaid diagrams, flash-card exports, pandoc variants)
- New skill packs

```bash
# Fork, clone, branch
pnpm install
pnpm build && pnpm test
# Submit PR against main
```

If `obs` helps you, a star goes a long way — it's how others discover the project.

---

## Acknowledgments

- [Andrej Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) for describing the LLM Wiki pattern that this project implements.
- [Obsidian](https://obsidian.md) for the markdown-vault format and the ecosystem that makes this possible.
- [Model Context Protocol](https://modelcontextprotocol.io) for the integration surface.
- [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) for pioneering agent-on-vault workflows.

---

## License

MIT — see [LICENSE](LICENSE).
