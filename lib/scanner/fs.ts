import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { IGNORE_DIRS } from './filter';

// Builds scan()'s input map from a working tree on disk. Mirrors the CLI's walk +
// read + relative-path logic from preflight.mjs exactly, so a scan of a checkout via
// this helper matches a CLI run. Used by the CLI and the parity test only — the
// backend worker never touches disk; it uses lib/github/source.ts instead.
export function readProjectFiles(rootDir: string): Record<string, string> {
  const out: Record<string, string> = {};

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!IGNORE_DIRS.has(name)) walk(full);
      } else {
        let content = '';
        try {
          content = readFileSync(full, 'utf8');
        } catch {
          /* ignore unreadable */
        }
        const rel = (relative(rootDir, full) || name).split(/[\\/]/).join('/');
        out[rel] = content;
      }
    }
  };

  walk(rootDir);
  return out;
}
