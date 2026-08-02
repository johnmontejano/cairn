import type { Metadata, Viewport } from 'next';
import { PRODUCT } from '@cairn/config';
import './globals.css';

export const metadata: Metadata = {
  title: { default: PRODUCT.name, template: `%s · ${PRODUCT.name}` },
  description: PRODUCT.tagline,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#10141a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
