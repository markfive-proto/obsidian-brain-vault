#!/bin/bash
# Gateway launcher: supergateway (stdio → streamableHttp) + OAuth proxy.
# Installed on the host at ~/bin/run-obs-gateway.sh and kept alive by the
# launchd agent (see com.marcuschia.obsmcp-gateway.plist.template).
#
# Required env (set in the launchd plist EnvironmentVariables, NOT here):
#   OBS_VAULT        absolute path to the vault
#   OBS_SECRET_PATH  secret URL path segment (openssl rand -hex 16)
#   OBS_BASE_URL     public https origin, e.g. https://obs-mcp.supermarcus.ai
#   ANTHROPIC_API_KEY / OPENAI_API_KEY  for the LLM/embedding KB tools

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export NODE_PATH="/opt/homebrew/lib/node_modules"

VAULT="${OBS_VAULT:?OBS_VAULT is required}"
SECRET_PATH="${OBS_SECRET_PATH:?OBS_SECRET_PATH is required}"
BASE="${OBS_BASE_URL:?OBS_BASE_URL is required}"

NODE="/opt/homebrew/bin/node"
SUPERGATEWAY="$(npm root -g)/supergateway/dist/index.js"
OBS_MCP="$(npm root -g)/obsidian-brain-vault/dist/mcp/server.js"

# Supergateway on 4322 (internal only)
#
# --stateful + --sessionTimeout: spawn ONE obs-mcp child per session (not per
# request) and auto-reap idle/orphaned sessions after 15 min. Stateless mode
# spawns a child per request and only reaps on a clean transport close, which
# the Cloudflare tunnel frequently skips on unclean disconnects — leaking
# orphaned node procs over multi-day uptimes.
"$NODE" "$SUPERGATEWAY" \
  --stdio "$NODE $OBS_MCP --vault $VAULT" \
  --outputTransport streamableHttp \
  --stateful \
  --sessionTimeout 900000 \
  --streamableHttpPath "/${SECRET_PATH}/mcp" \
  --port 4322 &

# OAuth proxy on 4321 (external, facing Cloudflare)
BASE_URL="$BASE" \
OAUTH_PORT=4321 \
MCP_PORT=4322 \
exec "$NODE" "$HOME/bin/obs-oauth-proxy.mjs"
