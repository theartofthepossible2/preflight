import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

// TEMPORARY diagnostic route — delete this file once the production DB
// connection is confirmed working. Token-gated so it isn't publicly readable
// (note: /api/* bypasses the basic-auth middleware). It never returns the
// password — only the host:port, whether the URL is set, whether it still
// contains a placeholder, and the raw Postgres error if the probe fails.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DIAG_TOKEN = 'pf_diag_7f3a9c21e8b4';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== DIAG_TOKEN) {
    return new NextResponse('Not found', { status: 404 });
  }

  const raw = process.env.DATABASE_URL ?? '';
  let host: string | null = null;
  try {
    host = new URL(raw).host || '(empty host)';
  } catch {
    host = '(unparseable URL)';
  }
  const isSet = raw.length > 0;
  const looksLikePlaceholder = raw.includes('[') || /YOUR[-_ ]?PASSWORD/i.test(raw);

  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: 'connected', host, isSet, looksLikePlaceholder });
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string; name?: string };
    return NextResponse.json({
      ok: false,
      host,
      isSet,
      looksLikePlaceholder,
      name: err?.name ?? null,
      code: err?.code ?? null,
      error: err?.message ?? String(e),
    });
  }
}
