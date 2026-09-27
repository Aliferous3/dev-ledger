import { LegalPageShell, LegalSection } from './LegalPageShell';

const EFFECTIVE = '28 SEPTEMBER 2026';

export function TermsOfServicePage() {
  return (
    <LegalPageShell
      title="TERMS OF SERVICE"
      subtitle="The rules that apply when you access or use Dev Ledger."
      effective={EFFECTIVE}
    >
      <LegalSection id="terms-acceptance" num="00" title="ACCEPTANCE OF THESE TERMS">
        <p>
          By selecting “Continue with GitHub”, creating or using a Dev Ledger account, or otherwise accessing the
          authenticated service, you agree to these Terms of Service. If you do not agree, do not continue with GitHub
          or use the authenticated service.
        </p>
        <p>
          The <a href="/privacy" className="text-neutral-300 underline underline-offset-4 hover:text-[#d6ff3e]">Privacy Policy</a> describes
          how Dev Ledger handles personal data and forms part of the rules governing use of the service.
        </p>
      </LegalSection>

      <LegalSection id="terms-service" num="01" title="THE SERVICE">
        <p>
          Dev Ledger connects to repositories authorized through the Dev Ledger GitHub App and turns GitHub-derived
          development metadata into dashboards, activity views, code metrics, project summaries, and longitudinal
          records.
        </p>
        <p>
          Dev Ledger is an evolving software service. Features, limits, data sources, visualizations, and availability
          may change over time.
        </p>
      </LegalSection>

      <LegalSection id="terms-eligibility" num="02" title="ELIGIBILITY & AUTHORITY">
        <p>
          You may use Dev Ledger only if you can lawfully agree to these Terms. If you use Dev Ledger for or on behalf
          of an organization, you represent that you have authority to connect the relevant GitHub account or
          repositories and to bind that organization where applicable.
        </p>
        <p>
          You are responsible for ensuring that your use of GitHub data through Dev Ledger is permitted by applicable
          law, your agreements, and your organization’s policies.
        </p>
      </LegalSection>

      <LegalSection id="terms-github" num="03" title="GITHUB ACCESS">
        <p>
          Dev Ledger relies on GitHub OAuth and a GitHub App. You decide which repositories the GitHub App can access
          through GitHub’s installation controls. Dev Ledger’s repository permissions are read-only for the functions
          described by the service.
        </p>
        <p>
          You must not authorize repositories or accounts that you are not permitted to connect. Removing repository
          access or uninstalling the GitHub App can stop future synchronization, but previously retained Dev Ledger
          analytics remain until removed through Dev Ledger’s deletion controls.
        </p>
      </LegalSection>

      <LegalSection id="terms-account" num="04" title="ACCOUNT & SESSION RESPONSIBILITIES">
        <p>
          You are responsible for maintaining the security of your GitHub account and devices used to access Dev
          Ledger. Do not attempt to share, transfer, or misuse another person’s authenticated Dev Ledger session.
        </p>
        <p>
          Dev Ledger may revoke sessions or restrict access when reasonably necessary to protect the service, comply
          with law, investigate misuse, or respond to a security incident.
        </p>
      </LegalSection>

      <LegalSection id="terms-use" num="05" title="ACCEPTABLE USE">
        <p>You must not use Dev Ledger to:</p>
        <ul className="space-y-2 list-none">
          <li><span className="text-[#d6ff3e]">▸</span> access repositories or data without authorization;</li>
          <li><span className="text-[#d6ff3e]">▸</span> violate law, contractual duties, privacy rights, intellectual-property rights, or GitHub’s rules;</li>
          <li><span className="text-[#d6ff3e]">▸</span> probe, bypass, disable, or interfere with authentication, rate limits, access controls, security mechanisms, or service infrastructure except through an expressly authorized security-testing process;</li>
          <li><span className="text-[#d6ff3e]">▸</span> introduce malicious code, automate abusive traffic, scrape the service at a harmful scale, or disrupt other users;</li>
          <li><span className="text-[#d6ff3e]">▸</span> misrepresent Dev Ledger output as an official GitHub record, audit, certification, employment verification, or guarantee of developer performance.</li>
        </ul>
      </LegalSection>

      <LegalSection id="terms-data" num="06" title="YOUR DATA & PERMISSIONS">
        <p>
          You retain whatever rights you already hold in your repositories and GitHub account data. These Terms do not
          transfer ownership of your source code or repositories to Dev Ledger.
        </p>
        <p>
          You grant Dev Ledger permission to access and process the GitHub-derived metadata made available through the
          GitHub App solely as needed to operate, secure, maintain, and improve the service as described in the Privacy
          Policy. Dev Ledger does not obtain permission to publish your private repository content merely because you
          connect a repository.
        </p>
      </LegalSection>

      <LegalSection id="terms-output" num="07" title="METRICS & OUTPUT LIMITATIONS">
        <p>
          Dev Ledger metrics are derived from available GitHub data, synchronization state, repository configuration,
          and product logic. They may be incomplete, delayed, or affected by force-pushes, deleted repositories,
          GitHub API limitations, attribution gaps, rate limits, disconnected repositories, or other technical
          conditions.
        </p>
        <p>
          Dev Ledger output is informational. It is not an official GitHub record, employment record, accounting
          record, legal opinion, security certification, or guarantee of productivity, quality, authorship, or
          professional performance.
        </p>
      </LegalSection>

      <LegalSection id="terms-thirdparty" num="08" title="THIRD-PARTY SERVICES">
        <p>
          Dev Ledger depends on third-party services including GitHub, Vercel, Supabase, and PostHog. Their services
          may be unavailable, changed, rate-limited, or discontinued independently of Dev Ledger, and your use of
          those services is also subject to their own terms and policies.
        </p>
      </LegalSection>

      <LegalSection id="terms-ip" num="09" title="DEV LEDGER INTELLECTUAL PROPERTY">
        <p>
          Except for third-party materials and user-controlled data, the Dev Ledger name, interface, visual design,
          software, documentation, and service-specific content are owned by or licensed to the Dev Ledger operator.
          No rights are granted except the limited right to use the service in accordance with these Terms.
        </p>
        <p>
          If source code is later released under an open-source license, that license will govern use of the released
          code separately from these service Terms.
        </p>
      </LegalSection>

      <LegalSection id="terms-availability" num="10" title="AVAILABILITY, CHANGES & TERMINATION">
        <p>
          We may modify, suspend, limit, or discontinue all or part of Dev Ledger. We may also limit or terminate
          access for material breach of these Terms, unlawful use, security risk, or where continued service is not
          reasonably possible.
        </p>
        <p>
          You may stop using Dev Ledger at any time. Repository-level deletion and account-level “Delete My Data”
          controls are available within the product, subject to the retention qualifications described in the Privacy
          Policy.
        </p>
      </LegalSection>

      <LegalSection id="terms-disclaimer" num="11" title="DISCLAIMERS">
        <p>
          To the maximum extent permitted by applicable law, Dev Ledger is provided on an “as is” and “as available”
          basis without warranties of uninterrupted operation, error-free output, fitness for a particular purpose, or
          preservation of any particular feature or metric.
        </p>
        <p>
          Nothing in these Terms excludes warranties, remedies, or consumer rights that cannot lawfully be excluded or
          limited.
        </p>
      </LegalSection>

      <LegalSection id="terms-liability" num="12" title="LIMITATION OF LIABILITY">
        <p>
          To the maximum extent permitted by applicable law, the Dev Ledger operator will not be liable for indirect,
          incidental, special, consequential, exemplary, or punitive damages, or for loss of profits, revenue,
          goodwill, business opportunity, or data, arising from or related to use of the service.
        </p>
        <p>
          Any limitation in these Terms applies only to the extent legally permitted and does not limit liability that
          cannot lawfully be limited.
        </p>
      </LegalSection>

      <LegalSection id="terms-law" num="13" title="APPLICABLE LAW & DISPUTES">
        <p>
          These Terms do not override mandatory rights or protections that apply to you under applicable law. Any
          dispute will be handled under the laws and procedures that legally apply to the operator, the user, and the
          particular dispute.
        </p>
        <p>
          Before starting formal proceedings, you are encouraged to contact Dev Ledger so the issue can be reviewed
          and, where possible, resolved informally.
        </p>
      </LegalSection>

      <LegalSection id="terms-changes" num="14" title="CHANGES & CONTACT">
        <p>
          We may update these Terms as Dev Ledger evolves. The effective date will be updated when the Terms change.
          Continued use after updated Terms become effective constitutes acceptance where permitted by law; where
          affirmative consent is legally required, Dev Ledger will seek it.
        </p>
        <p>
          Legal or service questions may be submitted through Dev Ledger’s in-app feedback channel. Privacy matters
          are also addressed in the <a href="/privacy" className="text-neutral-300 underline underline-offset-4 hover:text-[#d6ff3e]">Privacy Policy</a>.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
