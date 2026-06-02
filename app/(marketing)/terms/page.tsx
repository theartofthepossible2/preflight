import type { Metadata } from 'next';
import { Bullets, LegalShell, Section } from '../_components/legal';

export const metadata: Metadata = {
  title: 'Terms of Service — Preflight',
  description: 'The terms that govern your use of the Preflight service operated by Space.',
};

const CONTACT = 'admin@welcometospace.app';

export default function TermsOfService() {
  return (
    <LegalShell title="Terms of Service" updated="June 1, 2026">
      <p className="mt-6 text-sm leading-relaxed text-slate-600">
        These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between you and Space
        (&ldquo;Space,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) governing your use of the Preflight
        service (&ldquo;Preflight&rdquo; or the &ldquo;Service&rdquo;). By using the Service you agree
        to these Terms. If you do not agree, do not use the Service.
      </p>

      <Section heading="1. The Service">
        <p>
          Preflight is a deploy-time security gate. It scans your code in your own continuous-
          integration (CI) environment against specific security controls, reports findings, and can
          hold a production deployment when you configure it to do so. Preflight reports posture
          against specific controls; it is not a security certification and is not a substitute for a
          comprehensive security review, audit, or penetration test.
        </p>
      </Section>

      <Section heading="2. Accounts">
        <p>
          You sign in with GitHub. You are responsible for your account, for all activity under it,
          and for keeping your API keys confidential. You must provide accurate information and be
          old enough to form a binding contract.
        </p>
      </Section>

      <Section heading="3. Repository connection and automation">
        <p>
          You may optionally authorize our GitHub App to automate setup. By installing it you
          authorize Space, on your behalf, to create or update a workflow file and to create the{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">PREFLIGHT_API_KEY</code>{' '}
          secret in the repositories you select. You represent that you have authority over those
          repositories. You may revoke this access at any time by uninstalling the App from GitHub.
        </p>
      </Section>

      <Section heading="4. Subscriptions, billing, and cancellation">
        <p>
          Paid features require a subscription. Fees are described at checkout and are billed in
          advance on a recurring basis through our payment processor. Except where required by law,
          fees are non-refundable. You may cancel at any time from the dashboard; cancellation takes
          effect at the end of the current billing period. We may change pricing prospectively with
          notice.
        </p>
      </Section>

      <Section heading="5. Acceptable use">
        <p>You agree not to:</p>
        <Bullets
          items={[
            'use the Service other than as permitted by these Terms and the Preflight Software License;',
            'copy, modify, or create derivative works of the Service, or use it to build or operate a competing product or service;',
            'interfere with or disrupt the Service, circumvent rate limits or access controls, or probe it except under a program we authorize in writing;',
            'use the Service unlawfully or to infringe the rights of others; or',
            'misrepresent the Service or its results.',
          ]}
        />
      </Section>

      <Section heading="6. Intellectual property">
        <p>
          Space owns the Service, the Preflight scanner, the Preflight GitHub Action, and all related
          intellectual property, made available under the Preflight Software License included with
          the software. You retain all rights to your own code and content. You grant Space a
          limited license to process the scan data you submit, solely to provide the Service, as
          described in the Privacy Policy.
        </p>
      </Section>

      <Section heading="7. Security disclaimer; no guarantee">
        <p>
          THE SERVICE DOES NOT GUARANTEE THAT IT WILL DETECT ALL VULNERABILITIES OR PREVENT ANY
          PARTICULAR ATTACK, DEPLOYMENT, OR LOSS. Findings are labeled by confidence, and some are
          inferred rather than verified. You remain responsible for the security of your applications
          and for your decisions to deploy. Preflight is one control among many and is not a
          substitute for professional security review.
        </p>
      </Section>

      <Section heading="8. Warranty disclaimer">
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT
          WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A
          PARTICULAR PURPOSE, AND NONINFRINGEMENT. We do not warrant that the Service will be
          uninterrupted, timely, or error-free.
        </p>
      </Section>

      <Section heading="9. Limitation of liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, SPACE WILL NOT BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES, OR FOR ANY LOSS OF PROFITS,
          REVENUE, DATA, OR GOODWILL. OUR TOTAL LIABILITY ARISING OUT OF OR RELATED TO THE SERVICE
          WILL NOT EXCEED THE GREATER OF THE AMOUNTS YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM OR
          USD 100.
        </p>
      </Section>

      <Section heading="10. Indemnification">
        <p>
          You will indemnify and hold Space harmless from claims arising out of your content, your
          use of the Service, your repositories, or your violation of these Terms or applicable law.
        </p>
      </Section>

      <Section heading="11. Termination">
        <p>
          You may stop using the Service at any time. We may suspend or terminate your access if you
          breach these Terms or to protect the Service or others. On termination, your right to use
          the Service and the Action ends; provisions that by their nature should survive will
          survive.
        </p>
      </Section>

      <Section heading="12. Changes to the Service or Terms">
        <p>
          We may modify the Service or these Terms. Material changes to the Terms will be reflected by
          the &ldquo;Last updated&rdquo; date above and, where appropriate, additional notice.
          Continued use after changes take effect means you accept them.
        </p>
      </Section>

      <Section heading="13. Governing law">
        <p>
          These Terms are governed by the laws of the United States of America, without regard to its
          conflict-of-laws principles.
        </p>
      </Section>

      <Section heading="14. Contact">
        <p>
          Questions about these Terms:{' '}
          <a className="text-brand-700 hover:text-brand-800" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </Section>
    </LegalShell>
  );
}
