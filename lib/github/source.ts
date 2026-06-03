import { gunzipSync } from 'node:zlib';
import { isScannablePath, normalizePath } from '@/lib/scanner/filter';
import type { InstallationOctokit } from './app';
import { readTar } from './tar';

// Ephemeral, least-privilege source reader for the v0.4 backend worker. It downloads
// the repo tarball at an exact commit through the installation token, decompresses and
// parses it ENTIRELY IN MEMORY, keeps only the text files the scanner would inspect,
// and returns a { path -> contents } map shaped for scan(). Nothing is written to disk
// and nothing here persists source — the caller scans the map and drops it.
//
// We never execute, build, or install the code, and never log file contents. The CLI's
// equivalent (lib/scanner/fs.ts) walks a working tree; this is its on-the-wire twin and
// reuses the same classification (lib/scanner/filter) so a backend scan of a commit
// matches a CLI scan of the same checkout.

// Skip any single file larger than this — minified bundles and generated artifacts
// blow past it and carry no signal for a static posture check.
export const MAX_FILE_BYTES = 1_000_000;
// Cap on how many scannable files we admit, so a pathological repo can't exhaust the
// worker. Hitting it sets `truncated`; the scan still runs on what was admitted.
export const MAX_SCANNED_FILES = 10_000;
// Zip-bomb guard: gunzip aborts if the decompressed tar would exceed this.
export const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

export interface FetchRepoFilesResult {
  files: Record<string, string>;
  truncated: boolean;
}

export async function fetchRepoFiles(
  octokit: InstallationOctokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<FetchRepoFilesResult> {
  // GitHub answers with a 302 to codeload; octokit follows it and returns the gzipped
  // tarball as binary. The endpoint is typed loosely, hence the ArrayBuffer assertion.
  const res = await octokit.rest.repos.downloadTarballArchive({ owner, repo, ref });
  const gz = Buffer.from(res.data as ArrayBuffer);
  const tar = gunzipSync(gz, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  const entries = readTar(tar, { maxFileSize: MAX_FILE_BYTES });

  const files: Record<string, string> = {};
  let count = 0;
  let truncated = false;

  for (const entry of entries) {
    // Every codeload entry is wrapped in a top-level "<owner>-<repo>-<sha>/" directory;
    // strip that first path segment to get the repo-relative path.
    const slash = entry.name.indexOf('/');
    if (slash < 0) continue; // the wrapper directory entry itself
    const rel = normalizePath(entry.name.slice(slash + 1));
    if (!rel || !isScannablePath(rel)) continue;
    if (count >= MAX_SCANNED_FILES) {
      truncated = true;
      break;
    }
    files[rel] = entry.data.toString('utf8');
    count++;
  }

  return { files, truncated };
}
