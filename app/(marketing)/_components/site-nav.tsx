import Link from 'next/link';
import { Logo } from './icons';

const links = [
  { href: '/#how', label: 'How it works' },
  { href: '/#checks', label: 'What it checks' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/install', label: 'Setup' },
  { href: '/#faq', label: 'FAQ' },
];

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight text-slate-900"
        >
          <span className="text-brand-600">
            <Logo />
          </span>
          <span className="text-[17px]">Preflight</span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-slate-600 transition-colors hover:text-slate-900"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {signedIn ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/signin"
                className="hidden text-sm font-medium text-slate-700 transition-colors hover:text-slate-900 sm:block"
              >
                Sign in
              </Link>
              <Link
                href="/signin"
                className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
