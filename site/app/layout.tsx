import type { Metadata, Viewport } from 'next';

/* eslint-disable next/no-css-tags -- Public CSS avoids Vinext's dev-only CSS module content type. */

export const metadata: Metadata = {
  metadataBase: new URL('https://penghu.lexiansy.space'),
  title: '澎湖騎士｜3-Day License Rush',
  description: '三天完成台灣機車筆試衝刺的離線小遊戲。',
  alternates: {
    canonical: '/',
  },
  manifest: '/manifest.webmanifest',
  icons: [
    { rel: 'icon', url: '/art/app-icon-192.png', type: 'image/png', sizes: '192x192' },
    { rel: 'apple-touch-icon', url: '/art/app-icon-192.png', type: 'image/png', sizes: '192x192' },
  ],
  appleWebApp: {
    capable: true,
    title: '澎湖騎士',
    statusBarStyle: 'black-translucent',
  },
  openGraph: {
    title: '澎湖騎士｜3-Day License Rush',
    description: '三天完成台灣機車筆試衝刺。',
    url: '/',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '澎湖騎士 3-Day License Rush' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '澎湖騎士｜3-Day License Rush',
    description: '三天完成台灣機車筆試衝刺。',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0c5c66',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
