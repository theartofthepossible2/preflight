// Minimal, dependency-free tar reader for GitHub's repo tarballs. We only need to pull
// regular files out of an already-gunzipped archive held in memory — we deliberately do
// NOT extract to disk, follow symlinks, or honour device nodes. It understands POSIX
// ustar plus the two extensions GitHub's codeload actually emits for long paths: GNU
// long-name ('L') and pax extended-header 'path' records ('x'). Every other entry type
// (directory, symlink, hardlink, global header) is skipped, never followed.
//
// Scope note: this is just enough to read codeload output, not a general tar library.

export interface TarEntry {
  name: string;
  data: Buffer;
}

const BLOCK = 512;

// NUL-terminated ASCII field.
function readString(buf: Buffer, off: number, len: number): string {
  let end = off;
  const limit = Math.min(off + len, buf.length);
  while (end < limit && buf[end] !== 0) end++;
  return buf.toString('utf8', off, end);
}

// Sizes are octal ASCII; GNU also uses a base-256 form (high bit of the first byte set)
// for files too large for the octal field. Support both.
function readSize(buf: Buffer, off: number, len: number): number {
  if (buf[off] & 0x80) {
    let n = 0;
    for (let i = off + 1; i < off + len; i++) n = n * 256 + buf[i];
    return n;
  }
  const s = readString(buf, off, len).trim();
  return s ? parseInt(s, 8) || 0 : 0;
}

// Pull a 'path=' override out of a pax extended-header block. Records are
// "<decimal-length> key=value\n", where <length> counts the whole record incl. itself.
function paxPath(data: Buffer): string | null {
  const text = data.toString('utf8');
  let i = 0;
  while (i < text.length) {
    const sp = text.indexOf(' ', i);
    if (sp < 0) break;
    const len = parseInt(text.slice(i, sp), 10);
    if (!Number.isFinite(len) || len <= 0 || i + len > text.length) break;
    const record = text.slice(sp + 1, i + len).replace(/\n$/, '');
    const eq = record.indexOf('=');
    if (eq > 0 && record.slice(0, eq) === 'path') return record.slice(eq + 1);
    i += len;
  }
  return null;
}

export interface ReadTarOptions {
  // Skip (do not buffer or emit) any single file larger than this many bytes. The
  // archive itself is already bounded by the gunzip maxOutputLength in source.ts.
  maxFileSize?: number;
}

export function readTar(buf: Buffer, opts: ReadTarOptions = {}): TarEntry[] {
  const maxFileSize = opts.maxFileSize ?? Number.POSITIVE_INFINITY;
  const entries: TarEntry[] = [];
  let off = 0;
  let longName: string | null = null;
  let paxName: string | null = null;

  while (off + BLOCK <= buf.length) {
    // A zero-filled header marks end-of-archive (two are spec, one is enough to stop).
    if (buf[off] === 0) break;

    const size = readSize(buf, off + 124, 12);
    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) break; // truncated archive — stop rather than overrun

    const typeByte = buf[off + 156];
    const typeflag = typeByte === 0 ? '0' : String.fromCharCode(typeByte);

    if (typeflag === 'L') {
      // GNU long name: this block's data is the name of the NEXT entry.
      longName = readString(buf, dataStart, size);
    } else if (typeflag === 'x') {
      // pax extended header: may carry a 'path' override for the NEXT entry.
      paxName = paxPath(buf.subarray(dataStart, dataEnd));
    } else {
      // Any real entry consumes a pending long/pax name, whatever its type, so the
      // override never leaks onto a later file.
      const ustarName = readString(buf, off, 100);
      const prefix = readString(buf, off + 345, 155);
      const name = paxName ?? longName ?? (prefix ? `${prefix}/${ustarName}` : ustarName);
      longName = null;
      paxName = null;
      if (typeflag === '0' && size <= maxFileSize) {
        entries.push({ name, data: buf.subarray(dataStart, dataEnd) });
      }
    }

    // Advance past the header + data, rounded up to the next 512-byte boundary.
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}
