# obsidian-brain-vault — landing page (Brain Vault)

Next.js App Router static-export site for the `obsidian-brain-vault` project (brand: **Brain Vault**, CLI binary: `obs`). Deploys to Vercel.

## Develop

```bash
cd landing
pnpm install
pnpm dev
# http://localhost:3000
```

## Build (static export)

```bash
pnpm build
# Static HTML under ./out/
```

## Deploy

### Option A: standalone Vercel project

```bash
cd landing
vercel deploy --prod
```

### Option B: subpath of supermarcus.ai (recommended for SEO authority)

Two approaches:

**1. Vercel rewrite from supermarcus.ai → this project.** Add to `supermarcus.ai`'s `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/brain-os", "destination": "https://obs-landing.vercel.app" },
    { "source": "/brain-os/:path*", "destination": "https://obs-landing.vercel.app/:path*" }
  ]
}
```

The rewrite preserves the parent-domain authority while hosting the content on Vercel. Best for SEO.

**2. `basePath` build.** Deploy under a sub-path by setting env before build:

```bash
NEXT_PUBLIC_BASE_PATH=/brain-os \
NEXT_PUBLIC_SITE_URL=https://supermarcus.ai/brain-os \
pnpm build
# Then copy the contents of ./out/ into supermarcus.ai repo's public/brain-os/
```

## SEO primitives

- `app/layout.tsx` — full `Metadata` + `Viewport`, OpenGraph, Twitter Card, JSON-LD (`SoftwareApplication`)
- `app/opengraph-image.tsx` — dynamic 1200×630 OG image rendered at the Edge
- `app/robots.ts` and `app/sitemap.ts` — auto-generated
- Canonical URL via `NEXT_PUBLIC_SITE_URL`
- Keywords optimized for: `LLM wiki`, `Karpathy knowledge base`, `AI agent context`, `markdown knowledge base`, `MCP knowledge base`, `second brain CLI`

## Images

Static images under `public/` — symlinked from the repo's `docs/images/`. If you regenerate them, re-copy into `public/`.

## Customization points

- Colors / theme: `app/globals.css` (CSS variables)
- Content / copy: `app/page.tsx` (single file for the whole page)
- Social handle for Twitter Card: `app/layout.tsx` → `twitter.creator`
