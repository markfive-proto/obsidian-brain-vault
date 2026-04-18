# obsidian-brain-vault — landing + web UI

Next.js 15 App Router project that serves **two modes**:

1. **Marketing landing** (`/`) — the existing hero page.
2. **Multi-vault web UI** (`/vaults`) — a browsable dashboard over the
   vaults registered in `~/.obs/workspace.yaml`. This is what `obs serve`
   will ship when run locally on a user's machine.

## Develop

```bash
cd landing
pnpm install
pnpm dev
# http://localhost:3000
```

### Dev-mode vaults (no workspace registered)

If you don't have `~/.obs/workspace.yaml` populated yet, point the UI at
one or more directories with the `OBS_DEV_VAULTS` env var:

```bash
OBS_DEV_VAULTS=/path/to/vault-a,/path/to/vault-b pnpm dev
```

Each directory is surfaced as a synthetic vault named after its
basename. The first one is marked default.

## Build

```bash
pnpm build
pnpm start
```

This ships a **standard Next.js server build**, not a static export,
because the `/api/vaults/*` routes read the local filesystem at request
time. `output: 'export'` has been removed from `next.config.mjs`.

If you ever need the old static marketing-only build (e.g. to host on a
plain CDN), set `NEXT_EXPORT=1` at build time:

```bash
NEXT_EXPORT=1 pnpm build
# Static HTML under ./out/ — API routes won't work in this mode.
```

## Deploy implications

- **`obs serve` (local-host mode):** run `pnpm start` on port 4242. No
  base path, no external auth. Trusts `localhost` only.
- **Vercel / subpath deploy:** the marketing-only `NEXT_EXPORT=1` build
  still works for SEO deployments at `supermarcus.ai/brain-os`. Do NOT
  deploy the full API-route build publicly without adding auth — the
  `/api/vaults/*` endpoints read the host's `~/.obs/` directory.

## API surface

| Route | Purpose |
| --- | --- |
| `GET /api/vaults` | List all vaults with file counts. |
| `GET /api/vaults/:name` | Metadata + last-modified for one vault. |
| `GET /api/vaults/:name/tree?dir=raw\|compiled\|outputs` | File tree. |
| `GET /api/vaults/:name/file?path=<rel>` | Parsed markdown (frontmatter + body). `.md` only, 2MB cap, path-traversal rejected. |
| `POST /api/vaults/:name/ask` | Proxy to `askKb` — body `{ question, includeRaw? }`. |

## Architecture

```
landing/
├── app/
│   ├── page.tsx                          marketing hero
│   ├── vaults/
│   │   ├── page.tsx                      all-vaults grid
│   │   └── [name]/
│   │       ├── page.tsx                  raw / compiled / outputs browser
│   │       ├── VaultBrowser.tsx          client split-pane
│   │       └── ask/page.tsx              ask-a-question tab
│   └── api/vaults/...                    REST endpoints (Node runtime)
├── components/
│   ├── VaultSidebar.tsx                  left rail + ⌘K palette
│   ├── TabBar.tsx
│   ├── FileTree.tsx
│   ├── MarkdownView.tsx
│   └── AskPanel.tsx
└── lib/
    ├── workspace.ts                      temporary WorkspaceClient
    └── vault-fs.ts                       safe fs helpers (traversal-proof)
```

## Customization

- Colors / theme: `app/globals.css` (CSS variables).
- Marketing copy: `app/page.tsx`.
- Sidebar / command palette: `components/VaultSidebar.tsx`.

## SEO primitives (marketing mode)

- `app/layout.tsx` — full `Metadata` + `Viewport`, OpenGraph, Twitter Card.
- `app/robots.ts` and `app/sitemap.ts`.
- Canonical URL via `NEXT_PUBLIC_SITE_URL`.
