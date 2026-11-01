import type { Language, Role, SignupRole } from '@/types/api';

export const DEMO_PASSWORD = 'MandiMate@2026';

export interface DemoAccount {
  role: Role;
  email: string;
  name: string;
  org: string;
}

/** Seeded pilot accounts — one per role — so reviewers can walk every journey. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { role: 'farmer', email: 'ravi@mandimate.demo', name: 'Ravi Kumar', org: 'Madanapalle, Andhra Pradesh' },
  { role: 'buyer', email: 'procurement@freshbasket.demo', name: 'FreshBasket Retail', org: 'Procurement desk' },
  { role: 'transporter', email: 'dispatch@swiftagri.demo', name: 'SwiftAgri Logistics', org: 'Dispatch' },
  { role: 'coordinator', email: 'coordinator@madanapallefpo.demo', name: 'Madanapalle FPO', org: 'Field coordinator' },
  { role: 'admin', email: 'admin@mandimate.demo', name: 'MandiMate Ops', org: 'Platform admin' },
];

export const SIGNUP_ROLES: readonly SignupRole[] = ['farmer', 'buyer', 'transporter', 'coordinator'];

export function isSignupRole(value: unknown): value is SignupRole {
  return typeof value === 'string' && (SIGNUP_ROLES as readonly string[]).includes(value);
}

export const LANGUAGE_CODES: readonly Language[] = ['en', 'hi', 'te', 'kn', 'ur'];

export const INDIAN_STATES: readonly string[] = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];
