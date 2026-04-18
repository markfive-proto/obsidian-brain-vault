# Knowledge-Base Pack

A five-skill pack for building, maintaining, and querying personal markdown knowledge bases using LLMs. Implements Andrej Karpathy's [raw → compiled-wiki → Q&A → outputs → lint] workflow on top of Obsidian + the `obs` CLI.

## Why

Modern LLMs are very good at **manipulating knowledge** — not just code. Give them a directory of source material and they will build, maintain, and query a wiki that you never have to hand-write. The vault stays portable markdown. Obsidian is the IDE frontend. You rarely touch the wiki directly — it is the LLM's domain.

## The loop

```
   ┌─────────────┐
   │   ingest    │  URLs, PDFs, repos, transcripts, images, datasets → raw/
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │   compile   │  raw/ → compiled/ concept pages, summaries, backlinks, INDEX
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐            ┌─────────────┐
   │     qa      │◄───────────│    lint     │  health checks, gap-finding
   └──────┬──────┘            └──────▲──────┘
          │                          │
          ▼                          │
   ┌─────────────┐                   │
   │   render    │                   │
   └──────┬──────┘                   │
          │                          │
          └──── outputs/ ────────────┘
               (answers, slides, charts, briefs — filed back into vault)
```

Each skill is independently invokable via `/` slash commands. Chain them naturally: ingest → compile → qa → render.

## Skills

| Skill | Purpose | Key commands |
|---|---|---|
| [`ingest`](./ingest/SKILL.md) | Source → `raw/` markdown | `/clip` `/paper` `/repo` `/transcript` `/image` `/dataset` `/batch` |
| [`compile`](./compile/SKILL.md) | `raw/` → `compiled/` wiki | `/compile` `/compile-concept` `/compile-index` `/compile-diff` |
| [`qa`](./qa/SKILL.md) | Query wiki → `outputs/answers/` | `/ask` `/deep` `/compare` `/timeline` `/what-do-I-think` |
| [`lint`](./lint/SKILL.md) | Health check → `outputs/lint/` | `/lint` + `/lint-links` `/lint-orphans` `/lint-gaps` `/lint-impute` etc. |
| [`render`](./render/SKILL.md) | Wiki → slides / charts / briefs | `/slides` `/brief` `/chart` `/graph` `/timeline-chart` `/flashcards` `/handbook` `/talk` |

## Vault layout convention

```
<vault>/
  raw/              # immutable source material
    articles/
    papers/
    repos/
    images/
    transcripts/
    datasets/
    INGEST-LOG.md
  compiled/         # LLM-written wiki
    00-INDEX.md
    concepts/
    people/
    orgs/
    glossary.md
    COMPILE-LOG.md
  outputs/          # generated artifacts (still markdown)
    answers/
    reports/
    briefs/
    slides/
    charts/
    graphs/
    handbooks/
    lint/
```

## Getting started (15 minutes)

```bash
# 1. Register your vault with obs (once)
obs init
obs vault config defaultVault <your-vault-name>

# 2. Create the scaffold
obs folder create raw/{articles,papers,repos,images,transcripts,datasets}
obs folder create compiled/{concepts,people,orgs}
obs folder create outputs/{answers,reports,briefs,slides,charts,graphs,handbooks,lint}

# 3. Ingest your first source in Claude Code:
/clip https://karpathy.ai/...

# 4. Compile
/compile

# 5. Ask
/ask "what are Karpathy's heuristics for building an LLM KB?"

# 6. Lint periodically
/lint
```

## Required external tools

| Tool | Skills that use it | Install |
|---|---|---|
| `obs` | all | `npm i -g obsidian-vault-cli` (this repo) |
| `curl` | ingest | built-in |
| `yt-dlp` | ingest (transcripts) | `brew install yt-dlp` |
| `pdftotext`, `pdfimages` | ingest (papers) | `brew install poppler` |
| `gh` | ingest (repos) | `brew install gh` |
| `pandoc` (optional) | render (PDF export) | `brew install pandoc` |
| `marp-cli` (optional) | render (slides to PDF) | `npm i -g @marp-team/marp-cli` |
| `python3 + matplotlib, pandas` | render (charts) | `pip install matplotlib pandas` |
| `spider` (optional) | ingest (reader mode) | `cargo install spider_cli` |
| `exiftool` (optional) | ingest (image privacy) | `brew install exiftool` |

## Suggested Obsidian plugins

- **Dataview** — query notes by frontmatter
- **Marp** — preview slides inline
- **Advanced Tables** — for briefs/handbooks
- **Excalidraw** — hand-drawn companions
- **Periodic Notes** — daily KB review cadence
- **Omnisearch** — full-text fallback
- **Graph Analysis** — companion to `/graph`

## Scale notes

- **0-20 raw sources:** the loop feels clunky. Keep ingesting; don't over-structure compiled/.
- **20-100 sources:** sweet spot. `qa` starts finding non-obvious connections. `lint` reveals real gaps. Start filing derived outputs (`/slides`, `/brief`) back into the vault.
- **100-1000 sources:** `compile` runs get longer. Split the vault by domain (one pack per domain). Consider a full-text search tool the LLM can call (e.g., ripgrep wrapper).
- **1000+:** time to think about fine-tuning on the corpus (Karpathy's "Further explorations" note).

## Attribution

Pack design inspired by Andrej Karpathy's description of using LLMs to build personal knowledge bases, in which raw material is ingested into a directory, incrementally compiled into a markdown wiki, queried conversationally, and rendered into derived artifacts — all inside Obsidian, all in plain markdown.

> "You rarely ever write or edit the wiki manually — it's the domain of the LLM."

## License

MIT. Use it, fork it, file issues.
