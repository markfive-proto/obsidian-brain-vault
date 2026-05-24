# Knowledge Base — Quickstart

This folder is your knowledge base. Drop it inside any Obsidian vault (or use it as a standalone markdown folder) and it works out of the box with the `obs` CLI.

---

## Folder map

```
knowledgebase/
├── raw/              ← Drop sources here — articles, papers, PDFs, repos, transcripts
│   ├── articles/         web pages and blog posts
│   ├── papers/           arXiv papers
│   ├── pdfs/             local PDF documents
│   ├── repos/            GitHub repositories
│   ├── transcripts/      YouTube videos
│   ├── images/           screenshots, diagrams
│   └── INGEST-LOG.md     append-only registry of everything ingested
│
├── compiled/         ← LLM-written wiki — do not edit by hand
│   ├── 00-INDEX.md       master index, rebuilt on every compile
│   ├── COMPILE-LOG.md    append-only log of compile runs
│   ├── concepts/         one page per concept, cross-linked
│   ├── people/           one page per person
│   └── orgs/             one page per organisation
│
├── outputs/          ← Generated artifacts
│   ├── answers/          Q&A pairs from obs kb ask
│   ├── reports/          research reports
│   ├── slides/           Marp slide decks
│   ├── charts/           matplotlib charts
│   ├── briefs/           one-page executive briefs
│   ├── verify/           fact-check reports from obs kb verify
│   └── dream/            nightly AutoDream logs
│
└── tools/            ← AutoDream automation
    ├── dream.sh          nightly compile + lint + stats script
    └── setup-dream.sh    install dream.sh as launchd / cron job
```

---

## Step 1 — Install `obs`

```bash
npm install -g obsidian-brain-vault
obs --version
```

Point `obs` at this folder:

```bash
obs vault config defaultVault /path/to/this/knowledgebase
# or use --vault on every command
```

---

## Step 2 — Add your first source

**Web article:**
```bash
obs kb ingest https://example.com/article --vault .
```

**Local PDF (any PDF, not just arXiv):**
```bash
obs kb ingest ./my-report.pdf --vault .
```

**arXiv paper:**
```bash
obs kb ingest https://arxiv.org/abs/2501.12345 --vault .
```

**YouTube video:**
```bash
obs kb ingest https://youtube.com/watch?v=xxxxx --vault .
```

**GitHub repo:**
```bash
obs kb ingest https://github.com/owner/repo --vault .
```

Each ingest writes a clean markdown file to `raw/` and appends a line to `raw/INGEST-LOG.md`.

---

## Step 3 — Compile into the wiki

```bash
obs kb compile --vault .
```

The LLM reads your new raw sources, extracts concepts, and writes or updates pages in `compiled/concepts/`, `compiled/people/`, `compiled/orgs/`. The `compiled/00-INDEX.md` is rebuilt automatically.

Open the vault in Obsidian — every `[[wikilink]]` is live and the graph view shows how concepts connect.

---

## Step 4 — Ask questions

```bash
obs kb ask "What are the key ideas in my vault about attention mechanisms?" --vault .
```

The answer is saved to `outputs/answers/YYYY-MM-DD-<slug>.md` with wikilinks back to the sources it drew from. Every answer adds to the vault — future answers can use today's answer as context.

---

## Step 5 — Keep it healthy

```bash
obs kb lint --vault .     # broken links, orphans, thin pages, gaps
obs kb stats --vault .    # concept count, source count, compile freshness
```

---

## AutoDream — nightly background compilation

AutoDream runs `compile → lint → stats` automatically every night so your wiki is always fresh when you open Obsidian in the morning. It writes a log to `outputs/dream/dream-YYYY-MM-DD.md`.

### Install (one command)

```bash
bash tools/setup-dream.sh --vault /absolute/path/to/this/knowledgebase
```

macOS: installs as a launchd agent (runs at 2am).
Linux/WSL: adds a cron job (runs at 2am).

### Run manually

```bash
VAULT=/path/to/this/knowledgebase bash tools/dream.sh
```

### Dry run (see what it would do)

```bash
VAULT=/path/to/this/knowledgebase bash tools/dream.sh --dry-run
```

---

## Connect to Claude / Cursor / Windsurf (MCP)

Give your AI assistant direct read/write access to this knowledge base:

```bash
obs setup --vault /absolute/path/to/this/knowledgebase
```

This patches Claude Desktop, Claude Code, Cursor, and Windsurf configs in one shot. After restarting your editor, the AI can call `obs_kb_stats`, `obs_read_note`, `obs_search`, and 18 more tools directly.

---

## Install the Claude Code skill packs

The skills in this repo give Claude Code slash commands that mirror every `obs kb` command:

```bash
# from the obsidian-brain-vault repo root
obs skills install knowledge-base    # /clip /compile /ask /lint /render
obs skills install capture           # /dump /capture /quick
obs skills install clarify           # /articulate /expand /simplify
obs skills install connect           # /connect /trace /drift
obs skills install reflect           # /emerge /challenge /growth
obs skills install act               # /next /decide /graduate
obs skills install review            # /today /closeday /weekly
```

Then in any Claude Code session:

```
/clip https://example.com          → ingest article
/compile                           → compile all new raw sources
/ask what do I know about X?       → query + save answer
/lint                              → health check
```

---

## Frontmatter reference

Every file in this vault uses consistent YAML frontmatter so Obsidian properties, Dataview queries, and the `obs` CLI all work correctly.

**Raw files** (`raw/articles/`, `raw/papers/`, etc.):
```yaml
---
title: "Article or paper title"
date: 2026-05-24
source_url: https://example.com/article
source_type: article          # article | paper | pdf | repo | transcript
ingested_at: 2026-05-24T13:00:00.000Z
author: Author Name
tags: [raw, article, needs-compile]
---
```

**Compiled concept pages** (`compiled/concepts/`):
```yaml
---
title: Concept Name
aliases: [Concept Name]       # critical — enables [[Concept Name]] wikilinks
type: concept                 # concept | person | org
date: 2026-05-24
tags: [compiled, domain-tag]
first_seen: 2026-05-24T13:00:00.000Z
last_updated: 2026-05-24T13:00:00.000Z
sources_count: 3
---
```

The `aliases` field is what makes `[[Concept Name]]` resolve in Obsidian — without it, the index links would be ghost links since filenames are slugified (`scaled-dot-product-attention.md`).

---

## Full command reference

```bash
obs kb init                          # re-scaffold this folder if needed
obs kb ingest <url|file>             # add a source
obs kb compile                       # raw/ → compiled/ (incremental)
obs kb compile --full                # recompile everything from scratch
obs kb ask "question"                # query + save to outputs/answers/
obs kb lint                          # health check
obs kb stats                         # summary stats
obs kb list raw|concepts|outputs     # browse contents
obs kb verify <concept>              # fact-check [phase 3]
obs kb eval                          # measure wiki IQ [phase 3]
obs kb autohunt                      # overnight research [phase 3]
```

Every command supports `--vault <path>` and `--json`.
