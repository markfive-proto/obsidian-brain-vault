# `obs` — Open Vault CLI

Free, open-source CLI for Obsidian vaults. No Catalyst license needed.

[![npm version](https://img.shields.io/npm/v/obsidian-vault-cli)](https://www.npmjs.com/package/obsidian-vault-cli)
[![license](https://img.shields.io/npm/l/obsidian-vault-cli)](LICENSE)

---

## Why this exists

Obsidian's official CLI (v1.12+) requires a **$25 Catalyst license** (Early Access). Not everyone wants to pay for terminal access to their own notes.

`obs` gives you **100+ commands** for free by reading and writing vault files directly on disk. No running Obsidian instance needed. It is designed to complement [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) for AI agent workflows.

---

## How it relates to obsidian-skills

[**obsidian-skills**](https://github.com/kepano/obsidian-skills) is a collection of plain-text instruction files that teach AI agents how to work with Obsidian. It ships five skills:

| Skill | What it does | Requires CLI? |
|-------|-------------|---------------|
| `obsidian-markdown` | Read/write Obsidian-flavored Markdown | No — file-based |
| `obsidian-bases` | Work with Bases (database views) | No — file-based |
| `json-canvas` | Read/write JSON Canvas files | No — file-based |
| `defuddle` | Extract readable content from web pages | No — file-based |
| `obsidian-cli` | Teach AI to use the official paid CLI binary | **Yes — paid CLI** |

Four of the five skills work by reading and writing files directly — no CLI binary needed. The fifth skill (`obsidian-cli`) teaches AI agents to call the official Obsidian CLI, which requires a paid Catalyst license.

**`obs` fills the gap.** It provides the terminal commands that the paid CLI offers, for free. Use obsidian-skills for AI agent integration + `obs` for terminal commands = full Obsidian CLI experience without paying.

---

## What `obs` can vs can't do

### Can do (file-based operations)

- Read, create, search, and manage notes
- Manage frontmatter properties, tags, links, tasks
- Daily notes, templates, bookmarks
- Canvas and Bases files
- Plugin/theme management
- Git sync
- Full JSON output for scripting

### Can't do (requires a running Obsidian instance)

These commands exist only in the official paid CLI because they talk to Obsidian's runtime:

| Command | Why it needs the app |
|---------|---------------------|
| `eval code="..."` | Execute JS in Obsidian's runtime |
| `dev:screenshot` | Capture app screenshots |
| `dev:dom` / `dev:css` | Inspect Obsidian's UI |
| `plugin:reload` | Hot-reload plugins |
| Real-time sync | Requires Obsidian's sync engine |

---

## Installation

```bash
# From source (recommended for now)
git clone https://github.com/user/obsidian-vault-cli.git
cd obsidian-vault-cli
npm install && npm run build && npm link

# Verify
obs --version
```

---

## Quick Start

```bash
# Auto-detect and configure your vault
obs init

# Or set manually
obs vault config defaultVault /path/to/vault

# Start using
obs vault info
obs files list --limit 10
obs search content "product strategy"
obs tags all
```

---

## Command Reference

### `init` — Auto-detect vault

```bash
obs init                                        # Detect vaults and set default
```

### `vault` — Vault information and configuration

```bash
obs vault info                                  # Show vault name, path, file count, plugins
obs vault stats                                 # File counts, sizes, extension breakdown, top tags
obs vault config                                # Print all CLI config
obs vault config defaultVault                   # Print the default vault path
obs vault config defaultVault /path/to/vault    # Set the default vault
```

### `files` — File operations

```bash
obs files list                                  # List all files
obs files list --folder Notes --sort modified --limit 20
obs files read path/to/note.md                  # Print file content
obs files read path/to/note.md --head 10        # First 10 lines
obs files write path/to/note.md --content "New content"
obs files create path/to/new-note.md            # Create a new file
obs files create path/to/note.md --template Meeting
obs files delete path/to/note.md                # Delete (with confirmation)
obs files delete path/to/note.md --force        # Delete without confirmation
obs files move old/path.md new/path.md          # Move or rename
obs files rename path/to/note.md new-name.md
obs files total                                 # Count of markdown files
```

### `search` — Search vault content

```bash
obs search content "search term"                # Full-text search across all markdown
obs search content "TODO" --case-sensitive --limit 10
obs search path "meeting"                       # Find files by name (glob matching)
obs search path "**/*.canvas"                   # Glob pattern search
obs search regex "TODO|FIXME"                   # Regex search
obs search regex "\d{4}-\d{2}-\d{2}" --flags gi
```

### `tags` — Manage and query tags

```bash
obs tags list path/to/note.md                   # Show tags from a file's frontmatter
obs tags add path/to/note.md project            # Add a tag to frontmatter
obs tags remove path/to/note.md project         # Remove a tag from frontmatter
obs tags all                                    # Scan entire vault for tag counts
obs tags all --sort name                        # Sort alphabetically
obs tags all --min-count 5                      # Only tags appearing 5+ times
```

### `daily` — Daily notes

```bash
obs daily create                                # Create today's daily note
obs daily create --date 2025-01-15              # Create for a specific date
obs daily create --template "Daily Template"
obs daily open                                  # Print today's daily note
obs daily open --date 2025-01-15                # Print a specific day's note
obs daily list                                  # List recent daily notes
obs daily list --limit 30 --days 7              # Last 7 days, up to 30 results
```

### `properties` — Read and write frontmatter

```bash
obs properties read path/to/note.md             # Show all frontmatter properties
obs properties read path/to/note.md title       # Read a specific property
obs properties set path/to/note.md status draft
obs properties set path/to/note.md tags "a,b,c" # Comma-separated -> array
obs properties update path/to/note.md priority 1 # Alias for set
```

### `templates` — Template management

```bash
obs templates list                              # List available templates
obs templates apply "Meeting" Notes/standup.md  # Apply template to a file
obs templates create "Weekly Review"            # Create a new template
obs templates create "Bug Report" --content "## Bug\n\n## Steps"
```

### `tasks` — Find and manage tasks

```bash
obs tasks all                                   # List all tasks across the vault
obs tasks pending                               # Only unchecked tasks
obs tasks done                                  # Only completed tasks
obs tasks pending --file path/to/note.md        # Tasks in a specific file
obs tasks add path/to/note.md "Buy groceries"   # Append a new task
obs tasks toggle path/to/note.md 15             # Toggle checkbox at line 15
obs tasks remove path/to/note.md 15             # Remove task at line 15
```

### `bookmarks` — Manage vault bookmarks

```bash
obs bookmarks list                              # List all bookmarks
obs bookmarks add path/to/note.md               # Add a bookmark
obs bookmarks remove path/to/note.md            # Remove a bookmark
```

### `links` — Analyze links between notes

```bash
obs links list path/to/note.md                  # Show outgoing links
obs links outgoing path/to/note.md              # Alias for list
obs links backlinks path/to/note.md             # Find all files linking to this note
obs links broken                                # Find all unresolved wikilinks
obs links broken --limit 20
```

### `plugins` — Manage vault plugins

```bash
obs plugins list                                # List all plugins with status
obs plugins list --enabled                      # Only enabled plugins
obs plugins list --disabled                     # Only disabled plugins
obs plugins versions                            # Show community plugin versions
obs plugins enable dataview                     # Enable a community plugin
obs plugins disable dataview                    # Disable a community plugin
```

### `dev` — Developer tools

```bash
obs dev eval "vault.listFiles()"                # Evaluate JS with vault in scope
obs dev script ./my-script.js                   # Run a JS file with vault context
```

### `sync` — Git sync operations

```bash
obs sync status                                 # Show git status of the vault
obs sync push                                   # Stage, commit, and push
obs sync push --message "Updated notes"         # Custom commit message
obs sync pull                                   # Pull latest changes
```

### `themes` — Manage vault themes

```bash
obs themes list                                 # List installed themes
obs themes apply "Minimal"                      # Apply a theme
```

### `canvas` — Manage canvas files

```bash
obs canvas list                                 # List all canvas files
obs canvas read path/to/canvas.canvas           # Summarize a canvas
obs canvas create path/to/new.canvas            # Create a new canvas
obs canvas create path/to/new.canvas --text "Hello"  # With initial text node
obs canvas nodes path/to/canvas.canvas          # List all nodes
```

### `bases` — Manage base files

```bash
obs bases list                                  # List all base files
obs bases read path/to/base.base                # Read a base file
obs bases create path/to/new.base               # Create a new base
obs bases create path/to/new.base --source Notes
```

### `import` — Import content into the vault

```bash
obs import url https://example.com/article      # Import a URL as markdown
obs import url https://example.com --name "My Article"
```

---

## Global Options

Every command supports these flags:

| Flag | Description |
|------|-------------|
| `--vault <path>` | Path to the Obsidian vault (overrides `defaultVault` config) |
| `--json` | Output as JSON for scripting and piping |
| `--help` | Show help for any command |
| `--version` | Print the CLI version |

---

## JSON Mode & Scripting

All commands support `--json` for machine-readable output. Pipe to `jq` for filtering:

```bash
# Get vault file count as a number
obs vault stats --json | jq '.fileCount'

# Get all pending tasks and format as CSV
obs tasks pending --json | jq -r '.[] | [.file, .line, .text] | @csv'

# Find the top 5 tags
obs tags all --json | jq '.[0:5]'

# Search and extract just file paths from results
obs search content "TODO" --json | jq '[.[].file] | unique'
```

---

## Using with obsidian-skills

Install [obsidian-skills](https://github.com/kepano/obsidian-skills) in your vault for AI agent support, then use `obs` for terminal operations:

```bash
# Install obsidian-skills for AI agent support
cd /path/to/vault
git clone https://github.com/kepano/obsidian-skills .claude/

# Use obs for terminal operations
obs search content "meeting notes"
obs daily create
obs tags all --json | jq '.[].tag'
```

The skills teach AI agents how to read and write Obsidian files. `obs` gives those agents (and you) a fast way to query and modify the vault from the terminal.

---

## Development

```bash
npm run dev      # watch mode
npm test         # run tests
npm run build    # production build
```

---

## License

MIT
