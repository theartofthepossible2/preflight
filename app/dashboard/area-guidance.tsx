'use client';

import { useState } from 'react';

// Per-area "Generate fix prompt" control. On click it asks /api/guidance to run the
// Haiku -> Sonnet pipeline for THIS ASVS area of the user's latest scan, then renders the
// result inside the same fenced "AI assist" compartment the rest of the dashboard uses, so
// the model's text stays visibly distinct from the deterministic level above it. The button
// only appears for an active subscription (the server enforces this too).

interface Guidance {
  assessment: string;
  fixPrompt: string;
  refined: boolean;
}

export function AreaGuidance({
  category,
  subscribed,
}: {
  category: string;
  subscribed: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/guidance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      });
      const data = (await res.json().catch(() => null)) as
        | { assessment?: string; fixPrompt?: string; refined?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.assessment || !data?.fixPrompt) {
        setError(data?.error ?? 'Could not generate guidance.');
        return;
      }
      setGuidance({ assessment: data.assessment, fixPrompt: data.fixPrompt, refined: !!data.refined });
    } catch {
      setError('Connection lost. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function copyPrompt() {
    if (!guidance) return;
    try {
      await navigator.clipboard.writeText(guidance.fixPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (insecure context / permissions) — the prompt is still
      // visible and selectable, so this is non-fatal.
    }
  }

  if (!subscribed) {
    return (
      <p className="hint" style={{ marginTop: 10 }}>
        An active subscription unlocks an AI fix prompt for this area.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      {!guidance && (
        <button type="button" onClick={generate} disabled={loading}>
          {loading ? 'Generating…' : 'Generate fix prompt'}
        </button>
      )}
      {error && (
        <p className="hint" style={{ color: 'var(--high)', marginTop: 8, marginBottom: 0 }}>
          {error}
        </p>
      )}

      {guidance && (
        <div
          style={{
            borderLeft: '2px solid var(--accent)',
            background: 'rgba(106, 166, 255, 0.06)',
            borderRadius: '0 8px 8px 0',
            padding: '10px 12px',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              marginBottom: 6,
            }}
          >
            AI assist{guidance.refined ? '' : ' · draft'}
          </div>
          <p style={{ margin: 0, fontSize: 14 }}>{guidance.assessment}</p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              margin: '12px 0 4px',
            }}
          >
            <h4
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                margin: 0,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                fontWeight: 600,
                flex: '1 1 auto',
              }}
            >
              Fix prompt — paste into your coding assistant
            </h4>
            <button
              type="button"
              onClick={copyPrompt}
              style={{ padding: '4px 10px', fontSize: 12 }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{guidance.fixPrompt}</pre>

          <button
            type="button"
            onClick={generate}
            disabled={loading}
            style={{ marginTop: 10, padding: '4px 10px', fontSize: 12 }}
          >
            {loading ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      )}
    </div>
  );
}
