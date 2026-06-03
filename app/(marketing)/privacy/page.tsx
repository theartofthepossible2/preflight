import type { Metadata } from 'next';
import { Bullets, LegalShell, Section } from '../_components/legal';

export const metadata: Metadata = {
  title: 'Privacy Policy — Preflight',
  description: 'How Space collects, uses, and shares information in connection with the Preflight service.',
};

const CONTACT = 'admin@welcometospace.app';

export default function PrivacyPolicy() {
  return (
    <LegalShell title="Privacy Policy" updated="June 1, 2026">
      <p className="mt-6 text-sm leading-relaxed text-slate-600">
        This Privacy Policy explains how Space (&ldquo;Space,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;)
        collects, uses, and shares information in connection with the Preflight service
        (&ldquo;Preflight&rdquo; or the &ldquo;Service&rdquo;). If you do not agree with this Policy,
        do not use the Service. Questions: <a className="text-brand-700 hover:text-brand-800" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <Section heading="Who we are">
        <p>
          Space operates Preflight, a deploy-time security gate that scans your code in your own
          continuous-integration (CI) environment and reports posture against specific security
          controls. Space is the controller of the information described here.
        </p>
      </Section>

      <Section heading="Information we collect">
        <p>We collect only what we need to run the Service:</p>
        <Bullets
          items={[
            <>
              <strong>Account and sign-in.</strong> When you sign in with GitHub we receive your
              GitHub account identifier, username, name, email address, and avatar, plus an OAuth
              token limited to sign-in scope. Signing in does not grant access to your repositories.
            </>,
            <>
              <strong>Optional repository connection.</strong> If you choose to connect a repository
              to automate setup, you install our GitHub App. We use it to read repository metadata
              and to create or update a workflow file and the{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">PREFLIGHT_API_KEY</code>{' '}
              secret in the repositories you select. We request only the permissions needed for
              setup (repository contents, workflows, and secrets). We do not read, copy, or store
              your source code through the App, and you can uninstall it at any time from GitHub.
            </>,
            <>
              <strong>Scan data.</strong> When the Action runs in your CI it sends us limited
              results: the repository name, git ref, and commit SHA, and the findings it produces —
              including file paths, line numbers, short snippets of the flagged code, and finding
              metadata. The full contents of your repository are not transmitted; scanning runs
              inside your own CI.
            </>,
            <>
              <strong>API keys.</strong> We store only a hashed representation of each API key plus a
              short, non-secret prefix. The full key is shown to you once and is never stored in
              readable form.
            </>,
            <>
              <strong>Billing.</strong> Payments are handled by our third-party payment processor. We
              do not receive or store full payment card numbers; we store billing identifiers and
              your subscription status.
            </>,
            <>
              <strong>Technical and usage data.</strong> We log standard request and usage data (such
              as timestamps, IP address, and error information) to operate and protect the Service.
            </>,
          ]}
        />
      </Section>

      <Section heading="How we use information">
        <Bullets
          items={[
            'Provide, operate, and maintain the Service;',
            'Generate explanations and remediation guidance for findings;',
            'Manage your account, subscription, and billing;',
            'Prevent abuse and protect the Service and its users;',
            'Provide support and respond to your requests; and',
            'Comply with legal obligations.',
          ]}
        />
      </Section>

      <Section heading="Automated analysis and service providers">
        <p>
          We use third-party providers, acting as our processors, to host the Service, store data,
          process payments, and perform automated analysis of findings. These fall into the
          following categories: cloud hosting, managed database, payment processing, and automated
          analysis providers.
        </p>
        <p>
          When findings are analyzed, the finding metadata and code snippets described above may be
          processed by these providers solely to return explanations and remediation guidance. A
          current list of named sub-processors is available on request at{' '}
          <a className="text-brand-700 hover:text-brand-800" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </Section>

      <Section heading="How we share information">
        <p>
          We do not sell your information. We share it with the service providers above, with parties
          to a merger or acquisition, and where required by law or to protect the rights, property,
          or safety of Space, our users, or others.
        </p>
      </Section>

      <Section heading="Data retention">
        <p>
          We retain account and scan data while your account is active and as needed to provide
          history and meet legal obligations. On account closure we delete or de-identify your data
          within a reasonable period, except where retention is required by law.
        </p>
      </Section>

      <Section heading="Your choices and rights">
        <p>
          Depending on your location you may have rights to access, correct, export, or delete your
          information, and to object to or restrict certain processing. To exercise them, email{' '}
          <a className="text-brand-700 hover:text-brand-800" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          You can also disconnect GitHub and uninstall the GitHub App at any time, and cancel your
          subscription from the dashboard.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          We use reasonable technical and organizational measures to protect information, including
          encryption in transit, hashing of API keys, and database access controls. No method of
          transmission or storage is completely secure, and we cannot guarantee absolute security.
        </p>
      </Section>

      <Section heading="International users">
        <p>
          The Service is operated from the United States of America, and information is processed
          there. If you access the Service from outside the United States, you consent to that
          processing.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          The Service is not directed to children under 16, and we do not knowingly collect their
          information.
        </p>
      </Section>

      <Section heading="Changes to this Policy">
        <p>
          We may update this Policy from time to time. Material changes will be reflected by the
          &ldquo;Last updated&rdquo; date above and, where appropriate, additional notice.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about this Policy or your information:{' '}
          <a className="text-brand-700 hover:text-brand-800" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </Section>
    </LegalShell>
  );
}
