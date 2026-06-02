import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Preflight — security gate for Next.js + Supabase / Neon',
  description:
    'Preflight runs on every push, checks your code against critical security controls, and holds the production deploy until it passes. A deploy-time gate, not a security certification.',
  openGraph: {
    title: 'Preflight — block insecure deploys before they ship',
    description:
      'A security gate for Next.js + Supabase / Neon projects. Runs on every push and holds the production deploy until it passes.',
    siteName: 'Preflight',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Preflight — block insecure deploys before they ship',
    description:
      'A security gate for Next.js + Supabase / Neon projects. Runs on every push and holds the production deploy until it passes.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
