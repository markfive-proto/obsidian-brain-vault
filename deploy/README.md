# Deploy — remote MCP on the Mac mini

The production deployment (host `mk5-mac-mini-2.local`, "teo") serves the vault
at `https://obs-mcp.supermarcus.ai` through four layers:

```
Claude (web / mobile / Code)
  └─ Cloudflare Tunnel        com.marcuschia.cloudflared-obs   (~/.cloudflared/config.yml)
      └─ OAuth proxy :4321    obs-oauth-proxy.mjs              (RFC 8414 discovery + PKCE, auto-approve)
          └─ supergateway :4322                                (streamableHttp, --stateful, secret path)
              └─ obs-mcp (stdio)                               --vault ~/Documents/2ndbrain/2ndBrain
```

launchd agents on the host:

| Label | Runs |
|---|---|
| `com.marcuschia.obsmcp-gateway` | `~/bin/run-obs-gateway.sh` (supergateway + OAuth proxy) |
| `com.marcuschia.cloudflared-obs` | `cloudflared tunnel run` |
| `com.marcuschia.braindream` | nightly KB dream at 2am |

## Files here

| File | Purpose |
|---|---|
| `run-obs-gateway.sh` | Gateway launcher. Reads `OBS_VAULT` / `OBS_SECRET_PATH` / `OBS_BASE_URL` from env — install at `~/bin/` on the host |
| `obs-oauth-proxy.mjs` | Dependency-free OAuth 2.1 + PKCE proxy — install at `~/bin/` on the host |
| `com.marcuschia.obsmcp-gateway.plist.template` | launchd agent template. **Secrets (API keys, secret path) go in the installed plist's `EnvironmentVariables` — never in this repo** |
| `update-mini.sh` | One-command update on the host: pull → build → `npm i -g .` → kickstart gateway |
| `smoke.sh` | Local stdio smoke test of the built server (tool surface + readonly gating) |

## First-time install on a host

```bash
git clone https://github.com/markfive-proto/obsidian-brain-vault ~/obsidian-brain-vault
cd ~/obsidian-brain-vault && npm install && npm run build && npm install -g . supergateway

cp deploy/run-obs-gateway.sh deploy/obs-oauth-proxy.mjs ~/bin/ && chmod +x ~/bin/run-obs-gateway.sh
sed -e "s|__HOME__|$HOME|" \
    -e "s|__VAULT_PATH__|/path/to/vault|" \
    -e "s|__SECRET_PATH__|$(openssl rand -hex 16)|" \
    -e "s|__BASE_URL__|https://obs-mcp.yourdomain.com|" \
    -e "s|__ANTHROPIC_API_KEY__|sk-ant-...|" \
    -e "s|__OPENAI_API_KEY__|sk-...|" \
    deploy/com.marcuschia.obsmcp-gateway.plist.template \
    > ~/Library/LaunchAgents/com.marcuschia.obsmcp-gateway.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.marcuschia.obsmcp-gateway.plist
```

Cloudflare tunnel setup is documented in the main README ("Remote MCP" section).

## Updating (every deploy)

```bash
ssh marcuschia@mk5-mac-mini-2.local
bash ~/obsidian-brain-vault/deploy/update-mini.sh
```

Verify:

```bash
curl -s https://obs-mcp.supermarcus.ai/.well-known/oauth-authorization-server | head -c 200
launchctl print gui/$(id -u)/com.marcuschia.obsmcp-gateway | grep -E "state|pid"
tail -20 /tmp/obsmcp-gateway.log
```

## Notes

- **Long-running LLM tools** (`obs_kb_compile`, `obs_kb_ask`, `obs_kb_lint`) stream
  MCP progress notifications; clients that support `resetTimeoutOnProgress`
  keep the call alive. Work is bounded per call (compile defaults to 3
  sources) so a call stays in the ~1–3 min range.
- **`OBS_MCP_READONLY=1`** in the gateway env serves a read-only tool surface
  (hides all write/llm tools registered through the registry).
- **API keys** live only in the installed plist. If a key is missing, the LLM
  tools return a clean error naming the env var instead of crashing.
