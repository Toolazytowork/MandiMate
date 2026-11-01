import {
  BadgeCheck,
  Bell,
  CalendarClock,
  Combine,
  Gavel,
  HandCoins,
  Handshake,
  PackageCheck,
  ReceiptText,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ActionKind, NotificationType } from '@/types/api';

/** Icon for each dashboard action kind. */
export const ACTION_ICONS: Record<ActionKind, LucideIcon> = {
  consent: Handshake,
  offer: HandCoins,
  pickup: Truck,
  payment: Wallet,
  deadline: CalendarClock,
  verification: BadgeCheck,
  quote: ReceiptText,
  delivery: PackageCheck,
  dispute: Gavel,
  lot: Combine,
};

/** Icon for each notification / activity kind. */
export const ACTIVITY_ICONS: Record<NotificationType, LucideIcon> = {
  offer: HandCoins,
  consent: Handshake,
  lot: Combine,
  pickup: Truck,
  delivery: PackageCheck,
  payment: Wallet,
  harvest_deadline: CalendarClock,
  dispute: Gavel,
  verification: BadgeCheck,
  system: Bell,
};
