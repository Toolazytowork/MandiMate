import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { BadgeCheck, Bell, ChevronDown, LogOut, Settings } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  toast,
} from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { User } from '@/types/api';

/** Avatar trigger with account links and sign-out. */
export function UserMenu({ user }: { user: User }) {
  const { t } = useTranslation('common');
  const { logout } = useAuth();
  const navigate = useNavigate();
  const contact = user.email ?? user.phone;

  const signOut = async () => {
    try {
      await logout();
    } catch {
      toast.error(t('errors.generic', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      navigate('/login', { replace: true });
    }
  };

  return (
    <DropdownMenu
      label={t('a11y.userMenu', { defaultValue: 'Account menu' })}
      widthClassName="w-64"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className="group inline-flex h-10 items-center gap-2 rounded-sm ps-0.5 pe-1.5 transition-colors hover:bg-ink/[0.04] aria-expanded:bg-ink/[0.04] sm:pe-2.5"
        >
          <Avatar name={user.full_name} size="sm" />
          <span className="hidden max-w-[10rem] truncate text-sm font-normal text-ink md:inline">{user.full_name}</span>
          <ChevronDown
            aria-hidden="true"
            strokeWidth={1.25}
            className="hidden size-4 text-muted transition-transform duration-200 group-aria-expanded:rotate-180 sm:block"
          />
          <span className="sr-only">{t('a11y.userMenu', { defaultValue: 'Account menu' })}</span>
        </button>
      )}
    >
      <DropdownMenuLabel className="flex items-center gap-3 pb-3 text-xs normal-case tracking-normal">
        <Avatar name={user.full_name} size="md" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{user.full_name}</span>
          {contact ? <span className="block truncate text-xs text-muted">{contact}</span> : null}
          <span className="mt-1 block text-[13px] font-semibold text-gold-700">
            {t(`enums.role.${user.role}`, { defaultValue: user.role })}
          </span>
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuLinkItem to="/app/settings" icon={<Settings strokeWidth={1.25} />}>
        {t('nav.shared.settings', { defaultValue: 'Settings' })}
      </DropdownMenuLinkItem>
      <DropdownMenuLinkItem to="/app/notifications" icon={<Bell strokeWidth={1.25} />}>
        {t('nav.shared.notifications', { defaultValue: 'Notifications' })}
      </DropdownMenuLinkItem>
      {user.role === 'buyer' || user.role === 'transporter' ? (
        <DropdownMenuLinkItem to="/app/verification" icon={<BadgeCheck strokeWidth={1.25} />}>
          {t('nav.shared.verification', { defaultValue: 'Verification' })}
        </DropdownMenuLinkItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem tone="danger" icon={<LogOut strokeWidth={1.25} />} onSelect={signOut}>
        {t('nav.shared.signOut', { defaultValue: 'Sign out' })}
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
