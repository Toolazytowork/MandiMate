import { PageSeo } from '@/components/marketing/PageSeo';
import { LegalDocument, type LegalSection } from '@/components/marketing/info';

const SECTIONS: readonly LegalSection[] = [
  {
    id: 'agreement',
    title: 'About these terms',
    summary: 'By using MandiMate you agree to these terms; they are a pilot draft.',
    body: (
      <>
        <p>
          These terms govern your use of MandiMate by farmers, FPO and cluster coordinators, buyers and transporters. By
          creating an account or taking part in a sale, you agree to them and to our privacy policy.
        </p>
        <p>
          They are written in plain language for the Madanapalle pilot. Where a specific sale has its own written terms, such
          as a buyer&rsquo;s purchase agreement, those apply to that sale alongside these.
        </p>
      </>
    ),
  },
  {
    id: 'role',
    title: 'What MandiMate does',
    summary: 'We coordinate pooled sales; the sale itself is between farmers and the buyer.',
    body: (
      <p>
        MandiMate pools harvests, presents offers, records consent, coordinates transport and tracks quality and settlement.
        Unless a sale states otherwise, MandiMate acts as a facilitator: the contract of sale is between the participating
        farmers (or their FPO) and the buyer, and the transport contract is with the transporter.
      </p>
    ),
  },
  {
    id: 'accounts',
    title: 'Accounts and coordinators',
    body: (
      <ul>
        <li>Give accurate information and keep your phone number and payment details up to date.</li>
        <li>Keep your login private. You are responsible for actions taken from your account.</li>
        <li>
          A coordinator may register harvests and record consent on a farmer&rsquo;s behalf only with that farmer&rsquo;s
          clear agreement, and a confirmation is sent to the farmer.
        </li>
      </ul>
    ),
  },
  {
    id: 'consent',
    title: 'Offers and farmer consent',
    summary: 'No harvest is sold without its farmer saying yes to their own net amount.',
    body: (
      <>
        <p>
          Before your produce joins a sale you will see the offer, your gross amount and your estimated net amount after
          transport, handling, fees, expected rejection and payment timing, with each figure marked as confirmed, estimated or
          quoted. Your consent applies to that version of the offer.
        </p>
        <p>
          If the terms change materially, you will be asked again. You may withdraw before pickup is scheduled; after that,
          withdrawal is handled with your coordinator because it affects other members of the lot.
        </p>
      </>
    ),
  },
  {
    id: 'fees',
    title: 'Fees and estimates',
    summary: 'Every fee appears as its own line before you agree. Estimates can change; confirmed figures do not.',
    body: (
      <p>
        Any platform fee, transport share or handling charge is shown separately in the breakdown before consent. Estimated
        figures, such as expected rejection, can differ from the final outcome; the settlement statement shows the actual
        amounts and how they were calculated. Comparisons with selling alone are estimates based on local market information
        and are not a guarantee of any price.
      </p>
    ),
  },
  {
    id: 'quality',
    title: 'Quality, delivery and disputes',
    body: (
      <>
        <p>
          Quality is recorded at pickup and on delivery, with photos where possible. Rejected quantities are attributed to the
          share they came from. Buyers must raise quality claims within the window stated in the offer, with evidence.
        </p>
        <p>
          If you disagree with a quality decision or a settlement, raise it through the app or your coordinator. We will review
          the records from both checks and aim to resolve disputes within fourteen days.
        </p>
      </>
    ),
  },
  {
    id: 'payment',
    title: 'Payment and settlement',
    body: (
      <p>
        Buyers agree to pay within the terms stated in the offer. MandiMate tracks each settlement step and shows farmers when
        payment is due and when it has been made. Where MandiMate handles funds, it pays each farmer their share as set out in
        the settlement statement.
      </p>
    ),
  },
  {
    id: 'conduct',
    title: 'Fair use',
    body: (
      <ul>
        <li>Do not misrepresent quantities, grades or the origin of produce.</li>
        <li>Do not go around a lot to pressure individual farmers into side deals using information from MandiMate.</li>
        <li>Do not misuse other users&rsquo; data, or attempt to disrupt or reverse-engineer the service.</li>
      </ul>
    ),
  },
  {
    id: 'liability',
    title: 'Limits of responsibility',
    body: (
      <p>
        We work to keep MandiMate accurate and available, but we cannot control weather, market prices, road conditions or the
        actions of other parties. To the extent the law allows, MandiMate is not liable for indirect losses. Nothing in these
        terms limits rights you have under Indian law that cannot be excluded.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes, suspension and governing law',
    body: (
      <p>
        We may update these terms and will notify registered users before material changes take effect. We may suspend
        accounts that break these terms, after telling you why where we can. These terms are governed by the laws of India.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <>
      <PageSeo path="/terms" crumb="Terms of service" />
      <LegalDocument
        crumb="Terms of service"
        title="Terms of service"
        lead="The ground rules for farmers, buyers, transporters and coordinators — consent first, every rupee accounted for."
        updated="27 October 2026"
        sections={SECTIONS}
        related={{ to: '/privacy', label: 'Read the privacy policy' }}
      />
    </>
  );
}
