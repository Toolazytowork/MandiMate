import { Store, Sprout, Truck, Users, type LucideIcon } from 'lucide-react';

/** Public-site navigation shared by the marketing navbar, mobile menu and footer. */

export interface SiteLink {
  labelKey: string;
  label: string;
  to: string;
}

export interface Solution extends SiteLink {
  icon: LucideIcon;
  descriptionKey: string;
  description: string;
}

export const SOLUTIONS: readonly Solution[] = [
  {
    labelKey: 'nav.public.farmers',
    label: 'For farmers',
    to: '/farmers',
    icon: Sprout,
    descriptionKey: 'layout.solutions.farmers',
    description: 'Pool your harvest, compare real net earnings and get paid on time.',
  },
  {
    labelKey: 'nav.public.buyers',
    label: 'For buyers',
    to: '/buyers',
    icon: Store,
    descriptionKey: 'layout.solutions.buyers',
    description: 'Consistent, inspected lots sourced from coordinated farmer groups.',
  },
  {
    labelKey: 'nav.public.transporters',
    label: 'For transporters',
    to: '/transporters',
    icon: Truck,
    descriptionKey: 'layout.solutions.transporters',
    description: 'Fuller loads on planned pickup routes, priced by your own quotes.',
  },
  {
    labelKey: 'nav.public.fpos',
    label: 'For FPOs',
    to: '/fpos',
    icon: Users,
    descriptionKey: 'layout.solutions.fpos',
    description: 'Run aggregation, consent, transport and settlement in one place.',
  },
];

export const PRIMARY_LINKS: readonly SiteLink[] = [
  { labelKey: 'nav.public.howItWorks', label: 'How it works', to: '/how-it-works' },
  { labelKey: 'layout.site.calculator', label: 'Calculator', to: '/calculator' },
  { labelKey: 'nav.public.impact', label: 'Impact', to: '/impact' },
  { labelKey: 'nav.public.pricing', label: 'Pricing', to: '/pricing' },
];

export const COMPANY_LINKS: readonly SiteLink[] = [
  { labelKey: 'nav.public.about', label: 'About', to: '/about' },
  { labelKey: 'nav.public.faq', label: 'FAQ', to: '/faq' },
  { labelKey: 'nav.public.contact', label: 'Contact', to: '/contact' },
];

export const LEGAL_LINKS: readonly SiteLink[] = [
  { labelKey: 'nav.public.privacy', label: 'Privacy', to: '/privacy' },
  { labelKey: 'nav.public.terms', label: 'Terms', to: '/terms' },
];

export interface FooterColumn {
  id: string;
  labelKey: string;
  label: string;
  links: readonly SiteLink[];
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    id: 'product',
    labelKey: 'nav.groups.product',
    label: 'Product',
    links: [
      { labelKey: 'nav.public.howItWorks', label: 'How it works', to: '/how-it-works' },
      { labelKey: 'nav.public.calculator', label: 'Earnings calculator', to: '/calculator' },
      { labelKey: 'nav.public.pricing', label: 'Pricing', to: '/pricing' },
      { labelKey: 'nav.public.impact', label: 'Impact', to: '/impact' },
    ],
  },
  { id: 'solutions', labelKey: 'nav.groups.solutions', label: 'Solutions', links: SOLUTIONS },
  { id: 'company', labelKey: 'nav.groups.company', label: 'Company', links: COMPANY_LINKS },
];
