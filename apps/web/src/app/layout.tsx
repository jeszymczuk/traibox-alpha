import './globals.css';
// v9 module stylesheets (Ch.17 §18) — one file per screen family, shared primitives first.
import '../styles/modules/v9-shared.css';
import '../styles/modules/payments.css';
import '../styles/modules/finance.css';
import '../styles/modules/trade-room.css';
import '../styles/modules/counterparty.css';
import '../styles/modules/portfolio.css';
import '../styles/modules/inbox.css';
import '../styles/modules/payment-detail.css';
import '../styles/modules/network.css';
import '../styles/modules/clearance.css';
import '../styles/modules/settings.css';
import '../styles/modules/new-trade.css';
import '../styles/modules/intelligence.css';
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
