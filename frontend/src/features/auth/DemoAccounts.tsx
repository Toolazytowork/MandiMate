import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { cn } from '@/lib/cn';
import type { Role } from '@/types/api';

import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoAccount } from './constants';
import { RoleIcon } from './RoleIcon';

export function useRoleLabel() {
  const { t } = useTranslation('auth');
  return (role: Role) =>
    ({
      farmer: t('roles.farmer.title', { defaultValue: 'Farmer' }),
      buyer: t('roles.buyer.title', { defaultValue: 'Buyer' }),
      transporter: t('roles.transporter.title', { defaultValue: 'Transporter' }),
      coordinator: t('roles.coordinator.title', { defaultValue: 'FPO / Coordinator' }),
      admin: t('roles.admin.title', { defaultValue: 'Admin' }),
    })[role];
}

/** "Try a demo account" — one tap fills the sign-in form with a seeded pilot account. */
export function DemoAccounts({ onPick, selected }: { onPick: (account: DemoAccount) => void; selected?: string }) {
  const { t } = useTranslation('auth');
  const roleLabel = useRoleLabel();
  const [open, setOpen] = useState(true);

  return (
    <section aria-labelledby="demo-accounts-title" className="border-y border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="demo-accounts-list"
        className="flex w-full items-end gap-4 py-5 text-start focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <span className="min-w-0 flex-1">
          <span className="eyebrow block">{t('demo.eyebrow', { defaultValue: 'Pilot accounts' })}</span>
          <span id="demo-accounts-title" className="mt-2 block font-display text-2xl font-bold leading-tight text-ink">
            {t('demo.title', { defaultValue: 'Try a demo account' })}
          </span>
          <span className="mt-1 block text-sm font-normal text-ink-2">
            {t('demo.subtitle', { defaultValue: 'Pilot data, one account per role. Select a row to fill the form.' })}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 pb-1 text-[13px] font-semibold text-muted">
          {open ? t('demo.hide', { defaultValue: 'Hide' }) : t('demo.show', { defaultValue: 'Show' })}
          <ChevronDown
            aria-hidden="true"
            strokeWidth={1.25}
            className={cn('size-4 transition-transform duration-300 ease-luxe', open && 'rotate-180')}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id="demo-accounts-list"
            key="list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.2, 0.7, 0.1, 1] }}
            className="overflow-hidden"
          >
            <div
              aria-hidden="true"
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-4 border-t border-line py-2.5 text-[13px] font-semibold text-muted"
            >
              <span>{t('demo.col.no', { defaultValue: 'No.' })}</span>
              <span>{t('demo.col.account', { defaultValue: 'Role / account' })}</span>
              <span className="hidden sm:block">{t('demo.col.name', { defaultValue: 'Holder' })}</span>
            </div>
            <ul className="divide-y divide-line border-t border-line">
              {DEMO_ACCOUNTS.map((account, index) => {
                const active = selected === account.email;
                return (
                  <li key={account.email}>
                    <button
                      type="button"
                      onClick={() => onPick(account)}
                      aria-pressed={active}
                      className={cn(
                        'group relative grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-4 py-3.5 text-start transition-colors duration-300 ease-luxe focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-ink',
                        active ? 'bg-parchment' : 'hover:bg-parchment/60',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute inset-y-0 start-0 w-px transition-colors',
                          active ? 'bg-gold-700' : 'bg-transparent',
                        )}
                      />
                      <span aria-hidden="true" className="ps-2 font-display text-lg not-italic leading-none text-gold-700 tabular-nums">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                          <RoleIcon role={account.role} className="size-3.5 text-muted" />
                          {roleLabel(account.role)}
                        </span>
                        <span className="mt-1 block truncate font-mono text-xs text-ink-2">{account.email}</span>
                      </span>
                      <span className="hidden truncate text-sm font-normal text-ink-2 sm:block">
                        {account.name}
                        {active ? (
                          <span className="ms-3 text-[13px] font-semibold text-gold-700">
                            {t('demo.selected', { defaultValue: 'Selected' })}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line py-4 text-xs text-muted">
              {t('demo.password', { defaultValue: 'Every demo account uses the password' })}{' '}
              <code className="rounded-sm border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px] text-ink">{DEMO_PASSWORD}</code>
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
