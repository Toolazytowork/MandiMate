import { PageSeo } from '@/components/marketing/PageSeo';
import { LegalDocument, type LegalSection } from '@/components/marketing/info';

const SECTIONS: readonly LegalSection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are and what this covers',
    summary: 'This explains what we collect when you use MandiMate and why.',
    body: (
      <>
        <p>
          MandiMate is a marketplace that pools harvests from small farmers into lots for buyers, coordinates transport, and
          tracks quality and settlement. This policy covers the MandiMate website and app, and the work our coordinators do on
          your behalf, during the pilot in the Madanapalle cluster.
        </p>
        <p>
          It applies to farmers, FPO and cluster coordinators, buyers, transporters and anyone who writes to us.
        </p>
      </>
    ),
  },
  {
    id: 'what-we-collect',
    title: 'What we collect',
    summary: 'Only what we need to run your sales and prove whether they paid off.',
    body: (
      <ul>
        <li>
          <strong>Account details</strong> — your name, phone number, preferred language and role; for businesses, the
          organisation name and registration details.
        </li>
        <li>
          <strong>Farm and harvest details</strong> — village, approximate location of pickup points, crops, quantities,
          expected harvest dates, photos and voice notes you choose to share.
        </li>
        <li>
          <strong>Transaction records</strong> — offers, your consent decisions, pickup and delivery records, quality
          checks, and payment status.
        </li>
        <li>
          <strong>Payment details</strong> — the bank account or UPI ID you give us for settlement, stored only for paying
          you.
        </li>
        <li>
          <strong>Technical data</strong> — basic device and usage logs needed to keep the service secure and working.
        </li>
      </ul>
    ),
  },
  {
    id: 'how-we-use',
    title: 'How we use it',
    summary: 'To make, deliver and settle sales you agreed to, and to measure your real earnings.',
    body: (
      <>
        <ul>
          <li>Building lots, matching buyers and calculating each farmer&rsquo;s net earnings.</li>
          <li>Asking for and recording your consent, and keeping a record of it.</li>
          <li>Planning pickup routes and sharing the needed details with the transporter for that trip.</li>
          <li>Recording quality and resolving disputes fairly, using the evidence collected.</li>
          <li>Tracking settlement until payment reaches you.</li>
          <li>Measuring, in aggregate, whether pooled sales leave farmers better off than selling alone.</li>
        </ul>
        <p>We do not sell your personal data, and we do not use it for advertising.</p>
      </>
    ),
  },
  {
    id: 'ai',
    title: 'AI and automated suggestions',
    summary: 'AI helps with routine work; it never consents or decides for you.',
    body: (
      <p>
        We use AI tools to transcribe voice notes, suggest quality grades from photos and summarise offers. These suggestions
        are labelled, can be checked by a person, and are never used to give consent or to accept an offer on your behalf.
        Where an AI service processes your content, we send only what that task needs.
      </p>
    ),
  },
  {
    id: 'sharing',
    title: 'Who we share it with',
    summary: 'Only the people in your sale, the providers who help us run it, and authorities when the law requires.',
    body: (
      <ul>
        <li>
          <strong>Buyers</strong> see lot details — crop, grade, total quantity and pickup area — not your phone number or
          bank details.
        </li>
        <li>
          <strong>Transporters</strong> see the pickup points, quantities and a contact for the trip they accepted.
        </li>
        <li>
          <strong>Your coordinator</strong> sees what they need to help you register, consent and get paid.
        </li>
        <li>
          <strong>Service providers</strong> such as hosting, messaging and payment partners, under contracts that limit
          their use of your data.
        </li>
        <li>
          <strong>Authorities</strong>, when we are legally required to share information.
        </li>
      </ul>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <p>
        We keep account and transaction records for as long as your account is active and afterwards for the period the law
        requires for financial and tax records. Photos and voice notes are kept while they are useful for quality records or
        open disputes. Aggregated, anonymised results may be kept longer to report on impact.
      </p>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your choices and rights',
    summary: 'You can see, correct or delete your data, and withdraw consent for future use.',
    body: (
      <>
        <p>
          Under India&rsquo;s Digital Personal Data Protection Act, 2023, you can ask to access the personal data we hold
          about you, correct it, have it erased when it is no longer needed, and withdraw consent for future processing.
          Withdrawing consent does not undo sales already completed.
        </p>
        <p>
          You can also nominate someone to exercise these rights for you. To make a request, use the contact page or ask your
          coordinator.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: (
      <p>
        Data is encrypted in transit, access is limited by role, and actions on offers, consent and payments are logged. No
        system is perfectly secure; if a breach affects you, we will tell you and the relevant authority as the law requires.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes and contact',
    body: (
      <p>
        This is a pilot draft. We will update it as MandiMate grows and notify registered users before material changes take
        effect. Questions or complaints about privacy can be sent through our contact page, marked &ldquo;Privacy&rdquo;.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <PageSeo path="/privacy" crumb="Privacy policy" />
      <LegalDocument
        crumb="Privacy policy"
        title="Privacy policy"
        lead="Plain language first: what we collect, why we need it, who sees it, and the control you keep over it."
        updated="27 October 2026"
        sections={SECTIONS}
        related={{ to: '/terms', label: 'Read the terms of service' }}
      />
    </>
  );
}
