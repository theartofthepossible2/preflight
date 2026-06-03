import type { AnalyzedFinding } from '@/lib/types';
import { ASVS_VERSION } from '@/lib/asvs';
import { type AreaPosture, type PostureLevel, LEVEL_META, buildPosture, overallLevel } from '@/lib/asvs/posture';
import { ScanNow, type ScanNowRepo } from './scan-now';
import { AreaGuidance } from './area-guidance';

// The redesigned dashboard centerpiece: a project's security posture organized by ASVS
// area. The level chips (Safe / Safer available / Vulnerable) are deterministic — derived
// from scan findings in lib/asvs/posture, never from a model. AI-written text appears only
// inside the clearly-bordered "AI assist" compartment, and only when the scan was actually
// enriched, so the verdict and the AI assistance stay visibly distinct.

export interface PostureScan {
  repo: string | null;
  ref: string | null;
  commitSha: string | null;
  createdAt: Date;
  aiEnriched: boolean;
  findings: AnalyzedFinding[];
}

const LEVEL_COLOR: Record<PostureLevel, string> = {
  vulnerable: 'var(--high)',
  safer: 'var(--medium)',
  safe: 'var(--low)',
};

export function SecurityPosture({
  scan,
  repos,
  subscribed,
}: {
  scan: PostureScan | null;
  repos: ScanNowRepo[];
  subscribed: boolean;
}) {
  if (!scan) {
    return (
      <section className="uploader" style={{ borderStyle: 'solid' }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Security posture</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          No completed scan yet. A scan runs automatically on your next push or pull request
          to a connected repository, and the result appears here. You can also run one on
          demand below.
        </p>
        <ScanNow repos={repos} />
      </section>
    );
  }

  const areas = buildPosture(scan.findings);
  const overall = overallLevel(areas);
  const overallMeta = LEVEL_META[overall];

  return (
    <section className="uploader" style={{ borderStyle: 'solid' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 16, flex: '1 1 auto' }}>Security posture</h2>
        <span className={`chip ${overallMeta.chip}`}>{overallMeta.label}</span>
      </div>
      <div className="meta" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
        <code style={{ color: 'var(--text)' }}>{scan.repo ?? '(unknown repo)'}</code>
        {scan.commitSha ? ` @${scan.commitSha.slice(0, 7)}` : ''} · ASVS {ASVS_VERSION} ·{' '}
        {scan.aiEnriched ? 'AI-enriched' : 'findings only'} ·{' '}
        scanned {new Date(scan.createdAt).toLocaleString()}
      </div>

      <ScanNow repos={repos} />

      <div style={{ marginTop: 8 }}>
        {areas.map((area) => (
          <Area key={area.category} area={area} aiEnriched={scan.aiEnriched} subscribed={subscribed} />
        ))}
      </div>
    </section>
  );
}

function Area({
  area,
  aiEnriched,
  subscribed,
}: {
  area: AreaPosture;
  aiEnriched: boolean;
  subscribed: boolean;
}) {
  const meta = LEVEL_META[area.level];
  const summary =
    area.level === 'safe'
      ? 'nothing to do'
      : `${area.highCount} high · ${area.findings.length} ${area.findings.length === 1 ? 'finding' : 'findings'}`;

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '14px 0' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: LEVEL_COLOR[area.level],
            display: 'inline-block',
            flex: '0 0 auto',
          }}
        />
        <strong style={{ flex: '1 1 auto', fontSize: 15 }}>{area.label}</strong>
        <span className={`chip ${meta.chip}`}>{meta.label}</span>
      </div>
      <div className="meta" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4, paddingLeft: 18 }}>
        {area.chapter} · {area.controls.length} controls checked · {summary}
      </div>

      {area.findings.length > 0 ? (
        <div className="findings" style={{ marginTop: 10, paddingLeft: 18 }}>
          {area.findings.map((f) => (
            <FindingCard key={f.id} finding={f} aiEnriched={aiEnriched} />
          ))}
          <AreaGuidance category={area.category} subscribed={subscribed} />
        </div>
      ) : (
        <ul
          style={{
            margin: '8px 0 0',
            paddingLeft: 18,
            listStyle: 'none',
            color: 'var(--muted)',
            fontSize: 13,
          }}
        >
          {area.controls.map((c) => (
            <li key={c.id} style={{ marginTop: 2 }}>
              <span style={{ color: 'var(--low)' }}>✓</span> {c.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingCard({ finding, aiEnriched }: { finding: AnalyzedFinding; aiEnriched: boolean }) {
  return (
    <div className="finding">
      <div className="top">
        <span className={`sev ${finding.severity}`}>{finding.severity}</span>
        <h3>{finding.title}</h3>
        <span className="conf">{finding.confidence}</span>
      </div>
      <div className="meta">
        <code>
          {finding.file}
          {finding.line ? `:${finding.line}` : ''}
        </code>{' '}
        · {finding.detail}
      </div>

      {aiEnriched ? (
        <AiCompartment finding={finding} />
      ) : (
        <div className="body">
          <h4>Remediation</h4>
          <ol>
            {finding.remediation_steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// The compartmentalized AI surface: visually fenced off (accent left border + tint) and
// explicitly labeled so a customer can always tell the model's explanation apart from the
// deterministic verdict above it.
function AiCompartment({ finding }: { finding: AnalyzedFinding }) {
  return (
    <div
      style={{
        marginTop: 10,
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
        AI assist
      </div>
      <p style={{ margin: 0, fontSize: 14 }}>{finding.explanation}</p>
      {finding.remediation_steps.length > 0 && (
        <>
          <h4
            style={{
              fontSize: 12,
              color: 'var(--muted)',
              margin: '12px 0 4px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              fontWeight: 600,
            }}
          >
            Fix steps
          </h4>
          <ol style={{ paddingLeft: 18, margin: '4px 0', fontSize: 14 }}>
            {finding.remediation_steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </>
      )}
      {finding.codeFixExample && (
        <pre style={{ marginTop: 8 }}>{finding.codeFixExample}</pre>
      )}
    </div>
  );
}
