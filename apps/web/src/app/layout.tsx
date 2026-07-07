import './globals.css';
import type { Metadata } from 'next';
import { DM_Sans, JetBrains_Mono } from 'next/font/google';
import { Providers } from '../components/providers';

// TRAIBOX Design System v2.0 typography (Ch.17 §18.3):
// DM Sans for prose/UI, JetBrains Mono for IDs, amounts, codes, timestamps.
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-sans-loaded',
  display: 'swap'
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-mono-loaded',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'TRAIBOX',
  description: 'AI-native cross-border trade workspace'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${dmSans.variable} ${jetBrainsMono.variable}`}>
      <body className="text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
