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

By default `obs-mcp` speaks stdio, which only works on the same machine. To use your vault from **Claude.ai web chat**, a second device, or any tool that only supports HTTP MCP, wrap it with [`supergateway`](https://github.com/supermaven-inc/supergateway):

### 1. Install supergateway

```bash
npm i -g supergateway
```

### 2. Start the HTTP/SSE bridge

```bash
supergateway \
  --stdio "obs-mcp --vault /absolute/path/to/your/vault" \
  --port 4321 \
  --header "X-Accel-Buffering: no"
```

> **Why `--header "X-Accel-Buffering: no"`?** This tells Cloudflare (and nginx-based proxies) not to buffer the SSE response stream. Without it, the connection silently stalls when routed through a reverse proxy.

Your vault is now reachable at `http://localhost:4321/sse`.

### 3. Expose it over the internet with Cloudflare Tunnel (optional)

If you want to reach the vault from Claude.ai or any remote client:

```bash
# Install cloudflared once
brew install cloudflared

# Authenticate and create a tunnel
cloudflared tunnel login
cloudflared tunnel create obs-mcp

# Create ~/.cloudflared/config.yml
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: <your-tunnel-id>
credentials-file: ~/.cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: obs-mcp.yourdomain.com
    service: http://localhost:4321
    originRequest:
      disableChunkedEncoding: true   # required for SSE streaming
      tcpKeepAlive: 30s
      http2Origin: false
  - service: http_status:404
EOF

# Route your hostname to the tunnel
cloudflared tunnel route dns obs-mcp obs-mcp.yourdomain.com

# Run the tunnel
cloudflared tunnel run
```

Keep the tunnel alive on macOS with a LaunchAgent:

```bash
# Create ~/Library/LaunchAgents/com.yourname.cloudflared-obs.plist
# Set ProgramArguments to: cloudflared tunnel --config ~/.cloudflared/config.yml run
# Set RunAtLoad: true, KeepAlive: true
launchctl load ~/Library/LaunchAgents/com.yourname.cloudflared-obs.plist
```

### 4. Connect any remote client

Once the tunnel is running:

**Claude Desktop** — Claude Desktop only speaks stdio, so bridge the SSE stream with `mcp-remote`:

```json
{
  "mcpServers": {
    "obs-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://obs-mcp.yourdomain.com/sse"]
    }
  }
}
```

First launch takes 10–20 s while `npx` fetches `mcp-remote`. After that it's instant.

**Claude.ai web → Settings → Integrations → Add MCP Server** (supports SSE URLs natively):
```
https://obs-mcp.yourdomain.com/sse
```

**Claude Code:**
```bash
claude mcp add obs --url https://obs-mcp.yourdomain.com/sse
```

**Cursor / Windsurf** (via `mcp-remote`, same as Claude Desktop):
```json
{
  "mcpServers": {
    "obs-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://obs-mcp.yourdomain.com/sse"]
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
