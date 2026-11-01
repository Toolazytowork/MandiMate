/** FAQ content: rendered by the FAQ page and emitted verbatim as FAQPage JSON-LD (plain text answers). */
export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

export interface FaqGroup {
  id: string;
  title: string;
  lead: string;
  items: readonly FaqEntry[];
}

export const FAQ_GROUPS: readonly FaqGroup[] = [
  {
    id: 'selling',
    title: 'Selling and earnings',
    lead: 'What pooling is, and how we decide whether it is worth it for you.',
    items: [
      {
        id: 'what-is-mandimate',
        question: 'What does MandiMate actually do?',
        answer:
          'MandiMate pools small harvests from nearby farmers into one buyer-ready lot, finds buyers for it, and shows each farmer exactly what they would take home from the pooled sale compared with selling alone at the mandi. If you agree, we coordinate pickup, record delivery and quality, and track payment until the money reaches you.',
      },
      {
        id: 'net-vs-quoted',
        question: 'Why do you show net earnings instead of the price per kg?',
        answer:
          'A high quoted price can still leave you with less money once transport, loading, commission, rejected crates and late payment are taken out. Net earnings is the amount that actually reaches your hand, so it is the only fair way to compare a pooled sale with selling on your own.',
      },
      {
        id: 'how-calculated',
        question: 'How is my net earning calculated?',
        answer:
          'We start from the gross value of your share of the lot and subtract your share of transport (split by weight), handling and loading, any commission or platform fee, expected rejection for your grade, and the cost of waiting for payment. Every line is shown separately, with a marker telling you whether the number is confirmed, estimated or still a quote.',
      },
      {
        id: 'small-quantity',
        question: 'Is my harvest too small to take part?',
        answer:
          'No. Pooling exists for small harvests. A few crates on their own rarely justify a truck or interest a large buyer, but combined with your neighbours they can fill a vehicle and meet a buyer’s minimum order.',
      },
      {
        id: 'fees',
        question: 'What does it cost a farmer?',
        answer:
          'Joining is free. If a sale carries a platform fee or any other deduction, it appears as its own line in your breakdown before you are asked to agree, so you never discover a cost after the sale.',
      },
    ],
  },
  {
    id: 'consent',
    title: 'Consent and control',
    lead: 'Nothing is sold in your name without a clear yes from you.',
    items: [
      {
        id: 'consent-required',
        question: 'Can MandiMate sell my crop without my permission?',
        answer:
          'No. Your produce joins a sale only after you review the offer, see your own net amount beside the gross, and give consent. If the terms change materially after you agree, you are asked again.',
      },
      {
        id: 'withdraw',
        question: 'Can I change my mind after agreeing?',
        answer:
          'Yes, until pickup is scheduled you can withdraw from a lot. Once a truck has been booked for your share, withdrawing may affect your neighbours, so the coordinator will talk it through with you first.',
      },
      {
        id: 'sell-alone',
        question: 'What if selling alone is better for me?',
        answer:
          'Then we tell you. When the comparison shows the mandi would pay you more after costs, MandiMate says so plainly and you are free to sell on your own. Recommending a worse deal would defeat the purpose.',
      },
    ],
  },
  {
    id: 'operations',
    title: 'Transport, quality and payment',
    lead: 'What happens between your field and your bank account.',
    items: [
      {
        id: 'transport',
        question: 'Who arranges transport and how is the cost shared?',
        answer:
          'MandiMate plans a route that collects every member’s share, and verified transporters quote for the trip. The accepted cost is split by weight, so each farmer pays only for the space their produce uses.',
      },
      {
        id: 'quality',
        question: 'What happens if the buyer rejects part of the lot?',
        answer:
          'Quality is recorded at pickup and again at delivery, per farmer where possible, with photos. Rejection is attributed to the share it came from rather than spread across everyone, and disputed checks are reviewed against those records.',
      },
      {
        id: 'payment',
        question: 'When and how do I get paid?',
        answer:
          'The expected payment date is part of the offer you agree to, and the cost of waiting is already counted in your net amount. After delivery you can follow settlement step by step until the payment reaches your account.',
      },
      {
        id: 'smartphone',
        question: 'Do I need a smartphone?',
        answer:
          'It helps but is not required. A coordinator from your FPO or village cluster can register your harvest, read the offer to you in your language and record your consent on your behalf, with a confirmation sent to your phone.',
      },
    ],
  },
  {
    id: 'data',
    title: 'Data, AI and the pilot',
    lead: 'How we use information and software, and where we are today.',
    items: [
      {
        id: 'ai',
        question: 'How does MandiMate use AI?',
        answer:
          'AI helps with routine work such as reading voice notes, suggesting quality grades from photos and drafting offer summaries. It never gives consent for you, never sets your price on its own, and every AI suggestion is labelled so a person can check it.',
      },
      {
        id: 'data-sharing',
        question: 'Who can see my information?',
        answer:
          'Buyers see the lot, its grade and its total quantity, not your phone number or bank details. Your personal data is used to run your sales and to measure whether farmers earn more. We do not sell it.',
      },
      {
        id: 'where',
        question: 'Where is MandiMate available?',
        answer:
          'We are piloting in the Madanapalle tomato cluster in Andhra Pradesh, starting with tomato and nearby vegetable crops. If you are an FPO, buyer or transporter elsewhere, write to us and we will tell you when we can reach your area.',
      },
      {
        id: 'proof',
        question: 'How will you know whether farmers really earn more?',
        answer:
          'Every pooled sale is recorded against what the same farmer would have received selling alone that day. We publish the results, including the sales where pooling did not help, so the claim can be checked rather than taken on trust.',
      },
    ],
  },
];

export const FAQ_ITEMS: readonly FaqEntry[] = FAQ_GROUPS.flatMap((group) => group.items);
