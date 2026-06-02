import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Module-load must not throw — Vercel imports this during build for prerender,
// before runtime env vars are necessarily inspected. We fall back to a clearly
// invalid placeholder so the build succeeds; the first real query will fail
// with a connection error that surfaces the missing env var.
const PLACEHOLDER = 'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder';
const databaseUrl = process.env.DATABASE_URL || PLACEHOLDER;

// Supabase pooler (port 6543, transaction mode) does not support prepared statements,
// so we disable them. Safe to leave off for direct (5432) connections too.
const client = postgres(databaseUrl, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;
