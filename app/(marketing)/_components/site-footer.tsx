import Link from 'next/link';
import { Logo } from './icons';

const columns = [
  {
    heading: 'Product',
    links: [
      { href: '/#how', label: 'How it works' },
      { href: '/#checks', label: 'What it checks' },
      { href: '/#pricing', label: 'Pricing' },
    ],
  },
  {
    heading: 'Get started',
    links: [
      { href: '/install', label: 'Setup guide' },
      { href: '/#faq', label: 'FAQ' },
      { href: '/signin', label: 'Sign in' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <div className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
              <span className="text-brand-600">
                <Logo />
              </span>
              <span className="text-[17px]">Preflight</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              A security gate for Next.js + Supabase / Neon projects. It blocks the deploy before a
              regression reaches production.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:gap-16">
            {columns.map((col) => (
              <div key={col.heading}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {col.heading}
                </h3>
                <ul className="mt-3 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="text-sm text-slate-600 transition-colors hover:text-slate-900"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 border-t border-slate-200 pt-6">
          <p className="text-xs leading-relaxed text-slate-400">
            Preflight reports posture against specific security controls. It is a deploy-time gate,
            not a security certification or a substitute for a penetration test. Findings are labeled
            by confidence so you can see what is verified and what is inferred.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-400">
              &copy; {new Date().getFullYear()} Space. All rights reserved.
            </p>
            <nav className="flex items-center gap-4 text-xs">
              <Link href="/terms" className="text-slate-500 transition-colors hover:text-slate-900">
                Terms of Service
              </Link>
              <Link href="/privacy" className="text-slate-500 transition-colors hover:text-slate-900">
                Privacy Policy
              </Link>
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
