'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// The "Scan now" control: kicks off an on-demand scan and renders the server's progress as a
// live log, then refreshes the page so the deterministic posture above re-renders with the
// new result. Talks to /api/scan-now (Server-Sent Events); see app/api/scan-now/route.ts.

export interface ScanNowRepo {
  fullName: string;
  defaultBranch: string;
}

type LogKind = 'log' | 'error' | 'done';
interface LogLine {
  kind: LogKind;
  text: string;
}

const LOG_COLOR: Record<LogKind, string> = {
  log: 'var(--text)',
  error: 'var(--high)',
  done: 'var(--low)',
};

export function ScanNow({ repos }: { repos: ScanNowRepo[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(repos[0]?.fullName ?? '');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  if (repos.length === 0) return null;

  const append = (line: LogLine) => {
    setLogs((prev) => [...prev, line]);
    // Defer to next frame so the new node exists before we scroll it into view.
    requestAnimationFrame(() => {
      const el = logBoxRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  async function runScan() {
    if (!selected || running) return;
    setRunning(true);
    setLogs([{ kind: 'log', text: `Starting scan of ${selected}…` }]);

    try {
      const res = await fetch('/api/scan-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName: selected }),
      });

      if (!res.ok || !res.body) {
        const msg = (await res.json().catch(() => null)) as { error?: string } | null;
        append({ kind: 'error', text: msg?.error ?? 'Scan failed.' });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; keep the trailing partial in `buffer`.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const data = frame.replace(/^data: ?/, '').trim();
          if (!data) continue;
          let evt: { type?: string; message?: string; findings?: number; high?: number; aiEnriched?: boolean };
          try {
            evt = JSON.parse(data);
          } catch {
            continue;
          }
          if (evt.type === 'log' && evt.message) append({ kind: 'log', text: evt.message });
          else if (evt.type === 'error') append({ kind: 'error', text: evt.message ?? 'Scan failed.' });
          else if (evt.type === 'done') {
            completed = true;
            append({
              kind: 'done',
              text: `Done — ${evt.findings ?? 0} finding${evt.findings === 1 ? '' : 's'} (${evt.high ?? 0} high)${evt.aiEnriched ? ', AI-enriched' : ''}.`,
            });
          }
        }
      }

      if (completed) router.refresh();
    } catch {
      append({ kind: 'error', text: 'Connection lost during scan.' });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {repos.length > 1 && (
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={running}
            style={{
              padding: '8px 10px',
              font: 'inherit',
              background: 'var(--panel-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            {repos.map((r) => (
              <option key={r.fullName} value={r.fullName}>
                {r.fullName}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={runScan} disabled={running || !selected}>
          {running ? 'Scanning…' : 'Scan now'}
        </button>
        {selected && (
          <span className="hint" style={{ margin: 0 }}>
            scans the default branch of <code>{selected}</code>
          </span>
        )}
      </div>

      {logs.length > 0 && (
        <div
          ref={logBoxRef}
          style={{
            marginTop: 10,
            maxHeight: 220,
            overflowY: 'auto',
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '10px 12px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {logs.map((line, i) => (
            <div key={i} style={{ color: LOG_COLOR[line.kind], whiteSpace: 'pre-wrap' }}>
              <span style={{ color: 'var(--muted)' }}>{line.kind === 'done' ? '✓ ' : line.kind === 'error' ? '✗ ' : '· '}</span>
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
