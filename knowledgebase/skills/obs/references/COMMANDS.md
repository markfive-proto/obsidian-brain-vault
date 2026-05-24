# obs — Full Command Reference

Complete reference for all `obs` CLI commands with all options and detailed examples.

## Global Options

| Flag | Description | Default |
|------|-------------|---------|
| `--vault <path>` | Path to Obsidian vault | `defaultVault` from config |
| `--json` | Output as JSON | `false` |
| `--help` | Show help for any command | — |
| `--version` | Print CLI version | — |

---

## init

Auto-detect Obsidian vaults on the system and configure the default vault.

```bash
obs init
```

Reads `~/Library/Application Support/obsidian/obsidian.json` (macOS) to find known vaults. Prompts to select a default if multiple are found.

---

## vault

### vault info

Show vault name, path, file count, and enabled plugins.

```bash
obs vault info
obs vault info --json
```

### vault stats

Detailed statistics: file counts, total size, extension breakdown, top tags.

```bash
obs vault stats
obs vault stats --json
```

### vault config

Read or write CLI configuration stored at `~/.obsidian-cli/config.json`.

```bash
obs vault config                            # Print all config
obs vault config defaultVault               # Print default vault path
obs vault config defaultVault /path/to/vault  # Set default vault
```

---

## files

### files list

List files in the vault.

| Option | Description |
|--------|-------------|
| `--folder <path>` | Filter to a subfolder |
| `--ext <extension>` | Filter by file extension |
| `--sort <field>` | Sort by `name`, `modified`, `created`, `size` |
| `--limit <n>` | Limit results |

```bash
obs files list
obs files list --folder Notes --sort modified --limit 20
obs files list --ext canvas --json
```

### files read

Print file content.

| Option | Description |
|--------|-------------|
| `--head <n>` | Show only first n lines |
| `--tail <n>` | Show only last n lines |

```bash
obs files read path/to/note.md
obs files read path/to/note.md --head 10
obs files read path/to/note.md --json   # Returns { content, frontmatter }
```

### files write

Write content to an existing file (overwrites).

```bash
obs files write path/to/note.md --content "New content here"
```

### files create

Create a new file. Fails if file already exists.

| Option | Description |
|--------|-------------|
| `--content <text>` | Initial content |
| `--template <name>` | Apply a template |

```bash
obs files create path/to/new.md
obs files create path/to/note.md --template Meeting
obs files create path/to/note.md --content "# My Note"
```

### files delete

Delete a file.

| Option | Description |
|--------|-------------|
| `--force` | Skip confirmation prompt |

```bash
obs files delete path/to/note.md
obs files delete path/to/note.md --force
```

### files move

Move or rename a file.

```bash
obs files move old/path.md new/path.md
```

### files rename

Rename a file in the same directory.

```bash
obs files rename path/to/note.md new-name.md
```

### files total

Print count of markdown files in the vault.

```bash
obs files total
obs files total --json
```

---

## search

### search content

Full-text search across all markdown files.

| Option | Description |
|--------|-------------|
| `--case-sensitive` | Case-sensitive matching |
| `--limit <n>` | Max results |

```bash
obs search content "product strategy"
obs search content "TODO" --case-sensitive --limit 10
```

### search path

Find files by name using glob matching.

```bash
obs search path "meeting"
obs search path "**/*.canvas"
```

### search regex

Search with regular expressions.

| Option | Description |
|--------|-------------|
| `--flags <flags>` | Regex flags (e.g., `gi`) |

```bash
obs search regex "TODO|FIXME"
obs search regex "\d{4}-\d{2}-\d{2}" --flags gi
```

---

## tags

### tags list

Show tags from a file's frontmatter.

```bash
obs tags list path/to/note.md
```

### tags add

Add a tag to a file's frontmatter.

```bash
obs tags add path/to/note.md project
obs tags add path/to/note.md "status/active"
```

### tags remove

Remove a tag from a file's frontmatter.

```bash
obs tags remove path/to/note.md project
```

### tags all

Scan entire vault and show all tags with counts.

| Option | Description |
|--------|-------------|
| `--sort <field>` | Sort by `count` (default) or `name` |
| `--min-count <n>` | Only show tags with at least n occurrences |

```bash
obs tags all
obs tags all --sort name
obs tags all --min-count 5 --json
```

---

## daily

### daily create

Create a daily note.

| Option | Description |
|--------|-------------|
| `--date <YYYY-MM-DD>` | Date for the note (default: today) |
| `--template <name>` | Template to apply |

```bash
obs daily create
obs daily create --date 2025-01-15
obs daily create --template "Daily Template"
```

### daily open

Print the content of a daily note.

| Option | Description |
|--------|-------------|
| `--date <YYYY-MM-DD>` | Date to read (default: today) |

```bash
obs daily open
obs daily open --date 2025-01-15
```

### daily list

List recent daily notes.

| Option | Description |
|--------|-------------|
| `--limit <n>` | Max results |
| `--days <n>` | Look back n days |

```bash
obs daily list
obs daily list --limit 30 --days 7
```

---

## properties

### properties read

Read frontmatter properties from a file.

```bash
obs properties read path/to/note.md           # All properties
obs properties read path/to/note.md title     # Specific property
obs properties read path/to/note.md --json
```

### properties set / update

Set a frontmatter property. `update` is an alias for `set`.

```bash
obs properties set path/to/note.md status draft
obs properties set path/to/note.md tags "a,b,c"  # Comma-separated → array
obs properties update path/to/note.md priority 1
```

---

## templates

### templates list

List available templates in the vault's template folder.

```bash
obs templates list
obs templates list --json
```

### templates apply

Apply a template to a file.

```bash
obs templates apply "Meeting" Notes/standup.md
```

### templates create

Create a new template file.

| Option | Description |
|--------|-------------|
| `--content <text>` | Template content |

```bash
obs templates create "Weekly Review"
obs templates create "Bug Report" --content "## Bug\n\n## Steps to Reproduce"
```

---

## tasks

### tasks all

List all tasks (checked and unchecked) across the vault.

```bash
obs tasks all
obs tasks all --json
```

### tasks pending

List only unchecked tasks.

| Option | Description |
|--------|-------------|
| `--file <path>` | Filter to a specific file |

```bash
obs tasks pending
obs tasks pending --file path/to/note.md
```

### tasks done

List only completed tasks.

```bash
obs tasks done
obs tasks done --json
```

### tasks add

Append a new task to a file.

```bash
obs tasks add path/to/note.md "Buy groceries"
```

### tasks toggle

Toggle a task checkbox at a specific line number.

```bash
obs tasks toggle path/to/note.md 15
```

### tasks remove

Remove a task at a specific line number.

```bash
obs tasks remove path/to/note.md 15
```

---

## bookmarks

### bookmarks list

List all bookmarks in the vault.

```bash
obs bookmarks list
obs bookmarks list --json
```

### bookmarks add

Add a file to bookmarks.

```bash
obs bookmarks add path/to/note.md
```

### bookmarks remove

Remove a file from bookmarks.

```bash
obs bookmarks remove path/to/note.md
```

---

## links

### links list / outgoing

Show outgoing links from a file.

```bash
obs links list path/to/note.md
obs links outgoing path/to/note.md
```

### links backlinks

Find all files that link to a given note.

```bash
obs links backlinks path/to/note.md
obs links backlinks path/to/note.md --json
```

### links broken

Find all unresolved wikilinks in the vault.

| Option | Description |
|--------|-------------|
| `--limit <n>` | Max results |

```bash
obs links broken
obs links broken --limit 20 --json
```

---

## plugins

### plugins list

List all plugins with enabled/disabled status.

| Option | Description |
|--------|-------------|
| `--enabled` | Only enabled plugins |
| `--disabled` | Only disabled plugins |

```bash
obs plugins list
obs plugins list --enabled
obs plugins list --disabled --json
```

### plugins versions

Show installed community plugin versions.

```bash
obs plugins versions
obs plugins versions --json
```

### plugins enable

Enable a community plugin.

```bash
obs plugins enable dataview
```

### plugins disable

Disable a community plugin.

```bash
obs plugins disable dataview
```

---

## dev

### dev eval

Evaluate a JavaScript expression with the `vault` object in scope.

```bash
obs dev eval "vault.listFiles()"
obs dev eval "vault.readFile('Notes/test.md').frontmatter"
```

### dev script

Run a JavaScript file with `vault` in scope.

```bash
obs dev script ./my-script.js
```

---

## sync

### sync status

Show git status of the vault repository.

```bash
obs sync status
obs sync status --json
```

### sync push

Stage all changes, commit, and push.

| Option | Description |
|--------|-------------|
| `--message <msg>` | Custom commit message |

```bash
obs sync push
obs sync push --message "Updated meeting notes"
```

### sync pull

Pull latest changes from remote.

```bash
obs sync pull
```

---

## themes

### themes list

List installed themes.

```bash
obs themes list
obs themes list --json
```

### themes apply

Apply a theme.

```bash
obs themes apply "Minimal"
```

---

## canvas

### canvas list

List all `.canvas` files in the vault.

```bash
obs canvas list
obs canvas list --json
```

### canvas read

Summarize a canvas file (node count, edge count, types).

```bash
obs canvas read path/to/canvas.canvas
obs canvas read path/to/canvas.canvas --json
```

### canvas create

Create a new canvas file.

| Option | Description |
|--------|-------------|
| `--text <content>` | Create with an initial text node |

```bash
obs canvas create path/to/new.canvas
obs canvas create path/to/new.canvas --text "Hello"
```

### canvas nodes

List all nodes in a canvas.

```bash
obs canvas nodes path/to/canvas.canvas
obs canvas nodes path/to/canvas.canvas --json
```

---

## bases

### bases list

List all `.base` files in the vault.

```bash
obs bases list
obs bases list --json
```

### bases read

Read a base file.

```bash
obs bases read path/to/base.base
obs bases read path/to/base.base --json
```

### bases create

Create a new base file.

| Option | Description |
|--------|-------------|
| `--source <folder>` | Source folder for the base |

```bash
obs bases create path/to/new.base
obs bases create path/to/new.base --source Notes
```

---

## import

### import url

Import a URL as a markdown note.

| Option | Description |
|--------|-------------|
| `--name <title>` | Custom name for the imported note |

```bash
obs import url https://example.com/article
obs import url https://example.com --name "My Article"
```
