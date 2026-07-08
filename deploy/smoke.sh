#!/bin/bash
# Local MCP smoke test: boots the built server on the test fixture vault,
# runs initialize + tools/list over stdio, and checks the expected tools are
# present (and that OBS_MCP_READONLY hides write/llm tools).
set -euo pipefail
cd "$(dirname "$0")/.."

VAULT="${1:-tests/fixtures/test-vault}"

if [ ! -f dist/mcp/server.js ]; then
  echo "dist/ missing — run: npm run build"
  exit 1
fi

run_tools_list() {
  local extra_env="$1"
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
    sleep 1
  } | env $extra_env node dist/mcp/server.js --vault "$VAULT" 2>/dev/null \
    | grep '"id":2' \
    | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const r=JSON.parse(b);console.log(r.result.tools.map(t=>t.name).sort().join("\n"))})'
}

echo "==> full tool surface"
FULL=$(run_tools_list "SMOKE=1")
echo "$FULL" | sed 's/^/  /'

for t in obs_kb_ingest obs_kb_compile obs_kb_ask obs_kb_lint obs_search obs_read_note; do
  echo "$FULL" | grep -qx "$t" || { echo "FAIL: missing tool $t"; exit 1; }
done

echo "==> readonly surface (OBS_MCP_READONLY=1)"
RO=$(run_tools_list "OBS_MCP_READONLY=1")
for t in obs_kb_ingest obs_kb_compile obs_kb_ask obs_kb_lint; do
  echo "$RO" | grep -qx "$t" && { echo "FAIL: $t should be hidden in readonly mode"; exit 1; }
done

echo "OK: smoke passed"
