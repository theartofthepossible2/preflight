import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Preflight — ASVS posture check',
  description:
    'Deterministic security checks for Next.js + Supabase/Neon projects, with AI-augmented ASVS 5.0 explanations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
