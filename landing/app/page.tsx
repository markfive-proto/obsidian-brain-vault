import Image from 'next/image';

const GITHUB = 'https://github.com/markfive-proto/obsidian-brain-vault';
const KARPATHY_GIST = 'https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24 lg:py-28">
      {/* Hero */}
      <section aria-labelledby="hero-heading">
        <div className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
          <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5">MIT</span>
          <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[color:var(--accent)]">Free forever</span>
          <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5">CLI + MCP-ready</span>
          <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[color:var(--accent-2)]">Claude Code skill pack</span>
        </div>

        <h1
          id="hero-heading"
          className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
        >
          Brain Vault —<br />
          a knowledge base that writes itself.
        </h1>

        <p className="mt-3 font-mono text-sm text-[color:var(--muted)]">
          <span className="text-[color:var(--accent)]">obsidian-brain-vault</span> · CLI:{' '}
          <code className="text-[color:var(--foreground)]">obs</code>
        </p>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--muted)] sm:text-xl">
          The free, open-source implementation of{' '}
          <a
            href={KARPATHY_GIST}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[color:var(--foreground)] underline decoration-[color:var(--accent)] underline-offset-4"
          >
            Andrej Karpathy&rsquo;s LLM Wiki pattern
          </a>
          . Drop raw sources — an LLM compiles them into an interlinked wiki that gives your AI
          agents persistent context. CLI and MCP-ready out of the box.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-[color:var(--background)] transition hover:opacity-90"
          >
            Star on GitHub →
          </a>
          <a
            href="#quickstart"
            className="rounded-lg border border-[color:var(--border)] px-5 py-3 text-sm font-semibold text-[color:var(--foreground)] transition hover:border-[color:var(--accent)]"
          >
            2-minute quickstart
          </a>
          <a
            href="#why"
            className="rounded-lg border border-[color:var(--border)] px-5 py-3 text-sm font-semibold text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
          >
            How it works
          </a>
        </div>

        <div className="mt-14">
          <Image
            src="/hero-knowledge-tree.png"
            alt="A luminous knowledge tree growing from a terminal cursor — the obs knowledge base"
            width={1600}
            height={900}
            priority
            className="mx-auto w-full max-w-3xl rounded-2xl border border-[color:var(--border)]"
          />
        </div>
      </section>

      {/* Problem */}
      <section className="mt-28 border-t border-[color:var(--border)] pt-16" aria-labelledby="problem-heading">
        <h2 id="problem-heading" className="text-sm font-semibold uppercase tracking-widest text-[color:var(--accent)]">
          The problem
        </h2>
        <p className="mt-4 max-w-3xl text-2xl leading-relaxed sm:text-3xl">
          Every AI chat starts from zero. You re-explain who you are, what you&rsquo;re building,
          what you already know. The session ends and your best thinking disappears.
        </p>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[color:var(--muted)]">
          Meanwhile you have 20 browser tabs you meant to read, a folder of PDFs you never opened,
          and 500 notes that never link to each other. RAG retrieves the same chunks forever —
          nothing accumulates. Note apps are graveyards you have to maintain yourself.
        </p>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed">
          Your AI agents need <strong>persistent, compounding context</strong>. That&rsquo;s what{' '}
          <strong>Brain Vault</strong> gives them.
        </p>
      </section>

      {/* How it works */}
      <section id="why" className="mt-28" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-sm font-semibold uppercase tracking-widest text-[color:var(--accent)]">
          How it works
        </h2>
        <p className="mt-4 max-w-3xl text-2xl leading-relaxed sm:text-3xl">
          Three folders. One loop. Answers compound.
        </p>
        <div className="mt-10">
          <Image
            src="/karpathy-loop.png"
            alt="The Karpathy loop: RAW sources flow into COMPILED wiki, which produces OUTPUTS, which file back into RAW"
            width={1600}
            height={900}
            className="mx-auto w-full max-w-4xl rounded-2xl border border-[color:var(--border)]"
          />
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-6">
            <h3 className="font-mono text-sm text-[color:var(--accent-2)]">raw/</h3>
            <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted)]">
              Immutable source material you ingest. URLs, PDFs, repos, transcripts, images,
              datasets. Never rewritten.
            </p>
          </div>
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-6">
            <h3 className="font-mono text-sm text-[color:var(--accent)]">compiled/</h3>
            <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted)]">
              LLM-written concept pages with cross-references. Source #50 links back into the 10
              most-related pages that came before it.
            </p>
          </div>
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-6">
            <h3 className="font-mono text-sm text-[color:var(--foreground)]">outputs/</h3>
            <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted)]">
              Answers, slide decks, charts, lint reports. Every query you save becomes context for
              the next query.
            </p>
          </div>
        </div>
      </section>

      {/* Why Brain Vault */}
      <section className="mt-28" aria-labelledby="why-heading">
        <h2 id="why-heading" className="text-sm font-semibold uppercase tracking-widest text-[color:var(--accent)]">
          Why Brain Vault
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {[
            ['Free and open-source', 'MIT-licensed. No paid tier, no subscription, no lock-in.'],
            ['A Unix CLI', 'Pipeable, scriptable, cron-friendly. Runs headless on servers, in CI, from a shell script.'],
            ['100+ vault operations', 'Tags, tasks, links, daily notes, templates, canvas, bases, graph analysis — all from one tool.'],
            ['Built-in MCP server', 'Plug into Claude Desktop, Cursor, Windsurf, Claude Code. Your agents query the wiki natively.'],
            ['Claude Code skill pack', 'Slash commands mirror every CLI command for conversational workflows.'],
            ['Vendor-neutral', 'Works with any markdown folder. Obsidian-compatible today — your wiki goes with you.'],
          ].map(([title, body]) => (
            <li key={title} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted)]">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Quickstart */}
      <section id="quickstart" className="mt-28" aria-labelledby="quickstart-heading">
        <h2 id="quickstart-heading" className="text-sm font-semibold uppercase tracking-widest text-[color:var(--accent)]">
          Quickstart
        </h2>
        <p className="mt-4 max-w-3xl text-2xl leading-relaxed sm:text-3xl">
          From zero to querying your compiled wiki in two minutes.
        </p>

        <div className="mt-8 overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--card)]">
          <div className="flex items-center gap-2 border-b border-[color:var(--border)] bg-black/30 px-4 py-2 font-mono text-xs text-[color:var(--muted)]">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="ml-2">~/my-vault</span>
          </div>
          <pre className="overflow-x-auto p-5 text-sm leading-relaxed">
{`# 1. Install
pnpm add -g obsidian-brain-vault
obs --version

# 2. Point obs at your vault (auto-detects Obsidian vaults)
obs init

# 3. Scaffold raw/ compiled/ outputs/
obs kb init

# 4. The Karpathy loop
obs kb ingest https://example.com/article
obs kb ingest paper.pdf
obs kb compile
obs kb ask "what does my wiki say about X?"
obs kb lint

# 5. See the shape
obs kb stats`}
          </pre>
        </div>
      </section>

      {/* Integrations */}
      <section className="mt-28" aria-labelledby="integrations-heading">
        <h2 id="integrations-heading" className="text-sm font-semibold uppercase tracking-widest text-[color:var(--accent)]">
          Works with your agents
        </h2>
        <p className="mt-4 max-w-3xl text-2xl leading-relaxed sm:text-3xl">
          Ship context to any AI tool that speaks MCP.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {[
            ['Claude Code', 'Slash commands + MCP auto-discovery'],
            ['Claude Desktop', 'Add obs-mcp to claude_desktop_config.json'],
            ['Cursor', 'Add to ~/.cursor/mcp.json'],
            ['Windsurf', 'Add to ~/.codeium/windsurf/mcp_config.json'],
          ].map(([name, detail]) => (
            <div key={name} className="flex items-center justify-between rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] px-5 py-4">
              <span className="font-medium">{name}</span>
              <span className="text-xs text-[color:var(--muted)]">{detail}</span>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-[color:var(--muted)]">
          Full MCP setup with copy-paste JSON snippets in the{' '}
          <a href={`${GITHUB}#connect-it-to-claude-desktop--cursor--windsurf-mcp`} className="underline decoration-[color:var(--accent)] underline-offset-4">
            README
          </a>
          .
        </p>
      </section>

      {/* Roadmap */}
      <section className="mt-28" aria-labelledby="roadmap-heading">
        <h2 id="roadmap-heading" className="text-sm font-semibold uppercase tracking-widest text-[color:var(--accent)]">
          Roadmap
        </h2>
        <div className="mt-8 space-y-6">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--accent)]">Phase 1 — shipped</h3>
            <p className="mt-2 text-[color:var(--muted)]">
              <code className="font-mono">obs kb init / stats / list</code> native;{' '}
              <code className="font-mono">ingest / compile / ask / lint / render</code> via Claude
              Code skill pack. 6 MCP tools for the KB loop.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--accent-2)]">Phase 2 — next</h3>
            <p className="mt-2 text-[color:var(--muted)]">
              Native LLM-backed implementations via LiteLLM / Anthropic SDK. SHA-256 incremental
              compile. markitdown / pdftotext ingest.{' '}
              <code className="font-mono">obs kb watch</code> daemon.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--foreground)]">Phase 3 — the uniques</h3>
            <ul className="mt-3 space-y-2 text-[color:var(--muted)]">
              <li>
                <strong className="text-[color:var(--foreground)]">obs kb verify</strong> —
                fact-check each claim on a concept page against its cited sources; annotate
                hallucinations with <code className="font-mono">[!unverified]</code> callouts.
              </li>
              <li>
                <strong className="text-[color:var(--foreground)]">obs kb eval</strong> —
                self-test with held-out Q&amp;A, measure answer accuracy, track a weekly IQ trend.
              </li>
              <li>
                <strong className="text-[color:var(--foreground)]">obs kb autohunt</strong> —
                overnight research loop that hunts sources for your open questions and hands you a
                morning digest.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-28 border-t border-[color:var(--border)] pt-10 pb-4 text-sm text-[color:var(--muted)]">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p>
            Built by{' '}
            <a href="https://supermarcus.ai" className="underline decoration-[color:var(--accent)] underline-offset-4">
              Marcus Chia
            </a>
            . Inspired by{' '}
            <a href={KARPATHY_GIST} className="underline decoration-[color:var(--accent)] underline-offset-4">
              Andrej Karpathy&rsquo;s LLM Wiki gist
            </a>
            .
          </p>
          <div className="flex gap-4">
            <a href={GITHUB} className="hover:text-[color:var(--foreground)]">GitHub</a>
            <a href={`${GITHUB}/blob/main/LICENSE`} className="hover:text-[color:var(--foreground)]">MIT License</a>
            <a href={`${GITHUB}/issues`} className="hover:text-[color:var(--foreground)]">Issues</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
