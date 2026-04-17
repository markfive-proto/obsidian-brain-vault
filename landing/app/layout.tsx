import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://supermarcus.ai/brain-os';
const TITLE = 'Brain Vault — a knowledge base that writes itself. CLI + MCP-ready.';
const DESCRIPTION =
  "Free, open-source implementation of Andrej Karpathy's LLM Wiki pattern. Drop raw sources — an LLM compiles an interlinked wiki that gives your AI agents persistent, compounding context. CLI and MCP-ready, with a Claude Code skill pack.";
const KEYWORDS = [
  'LLM wiki',
  'Karpathy knowledge base',
  'AI agent context',
  'markdown knowledge base',
  'MCP knowledge base',
  'Obsidian brain vault',
  'Obsidian CLI',
  'Obsidian MCP',
  'second brain CLI',
  'free knowledge base',
  'AI second brain',
  'compiled wiki',
];

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s — Brain Vault',
  },
  description: DESCRIPTION,
  keywords: KEYWORDS,
  authors: [{ name: 'Marcus Chia', url: 'https://supermarcus.ai' }],
  creator: 'Marcus Chia',
  applicationName: 'Brain Vault',
  category: 'technology',
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Brain Vault — obsidian-brain-vault',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Brain Vault — a knowledge base that writes itself',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.png'],
    creator: '@marcuschia',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0f1a',
  width: 'device-width',
  initialScale: 1,
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Brain Vault (obsidian-brain-vault)',
  description: DESCRIPTION,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'macOS, Linux, Windows',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  license: 'https://opensource.org/licenses/MIT',
  codeRepository: 'https://github.com/markfive-proto/obsidian-brain-vault',
  programmingLanguage: 'TypeScript',
  url: SITE_URL,
  author: {
    '@type': 'Person',
    name: 'Marcus Chia',
    url: 'https://supermarcus.ai',
  },
  keywords: KEYWORDS.join(', '),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Script
          id="ld-json"
          type="application/ld+json"
          strategy="beforeInteractive"
        >
          {JSON.stringify(jsonLd)}
        </Script>
        {children}
      </body>
    </html>
  );
}
