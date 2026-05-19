import './globals.css';
import type { Metadata } from 'next';
import { Providers } from '../components/providers';

export const metadata: Metadata = {
  title: 'TRAIBOX',
  description: 'AI-first trade workspace'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="bg-paper text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
