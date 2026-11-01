import { Building2, Shield, ShoppingBasket, Sprout, Truck, type LucideProps } from 'lucide-react';

import type { Role } from '@/types/api';

const ICONS = {
  farmer: Sprout,
  buyer: ShoppingBasket,
  transporter: Truck,
  coordinator: Building2,
  admin: Shield,
} as const;

export function RoleIcon({ role, ...props }: { role: Role } & LucideProps) {
  const Icon = ICONS[role];
  return <Icon aria-hidden="true" strokeWidth={1.25} {...props} />;
}
