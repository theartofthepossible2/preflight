import { auth } from '@/auth';
import { SiteNav } from './_components/site-nav';
import { SiteFooter } from './_components/site-footer';

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Light surface. `role="main"` instead of <main> on purpose: the legacy dark
  // globals.css has an unlayered `main { max-width: 880px }` rule that would
  // otherwise clamp full-bleed marketing sections.
  return (
    <div className="mkt min-h-screen bg-white font-sans text-slate-700 antialiased">
      <SiteNav signedIn={Boolean(session?.user)} />
      <div role="main">{children}</div>
      <SiteFooter />
    </div>
  );
}
