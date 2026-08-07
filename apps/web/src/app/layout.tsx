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
  // One ground, so one colour. Advertising a pale theme-colour to a
  // light-mode browser tinted the address bar and the iOS status bar to a
  // canvas the product no longer has, which reads as a flash of the old
  // interface before the first paint.
  themeColor: '#10141a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
