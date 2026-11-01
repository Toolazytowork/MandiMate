import { useId, useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useNavigate } from 'react-router';
import { LogOut } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { EASE_LUXE } from '@/components/motion/tokens';
import { Avatar, Badge, IconButton, toast } from '@/components/ui';
import { roleHome, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import type { User } from '@/types/api';
import { LanguageSwitcher } from './LanguageSwitcher';
import { navigationFor } from './navigation';

export interface SidebarProps {
  user: User;
  /** Called after a navigation link is followed (closes the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
}

/** Light workspace sidebar: role-aware groups, 1 px green active rail, language and account. */
export function Sidebar({ user, onNavigate, className }: SidebarProps) {
  const { t } = useTranslation('common');
  const layoutId = useId();
  const groups = navigationFor(user.role);

  return (
    <div className={cn('relative flex h-full w-full flex-col overflow-hidden border-e border-line bg-paper', className)}>
      <div className="relative flex h-20 shrink-0 items-center px-6">
        <Link
          to={roleHome(user.role)}
          onClick={onNavigate}
          className="rounded-sm"
          aria-label={t('layout.shell.home', { defaultValue: 'MandiMate — workspace home' })}
        >
          <Logo size="sm" />
        </Link>
      </div>
      <div className="hairline mx-6 shrink-0" />

      <nav
        aria-label={t('a11y.mainNavigation', { defaultValue: 'Main navigation' })}
        className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-3 py-7"
      >
        <LayoutGroup id={layoutId}>
          {groups.map((group) => (
            <div key={group.id} className="mb-8 last:mb-0">
              <p className="px-3 pb-3 text-[12px] font-semibold text-muted">
                {t(group.labelKey, { defaultValue: group.label })}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((entry) => (
                  <li key={entry.to}>
                    <NavLink
                      to={entry.to}
                      end={entry.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex h-10 items-center gap-3 rounded-sm ps-3 pe-2 text-[14px] font-medium transition-colors duration-300',
                          isActive
                            ? 'bg-forest-50 text-forest-700'
                            : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive ? (
                            <motion.span
                              layoutId="sidebar-active-rail"
                              aria-hidden="true"
                              className="absolute -start-3 top-2 bottom-2 w-[3px] rounded-e-full bg-forest-600"
                              transition={{ duration: 0.32, ease: EASE_LUXE }}
                            />
                          ) : null}
                          <entry.icon
                            aria-hidden="true"
                            strokeWidth={1.25}
                            className={cn(
                              'size-[18px] shrink-0 transition-colors duration-300',
                              isActive ? 'text-forest-600' : 'text-muted group-hover:text-ink-2',
                            )}
                          />
                          <span className="truncate">{t(entry.labelKey, { defaultValue: entry.label })}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </LayoutGroup>
      </nav>

      <div className="relative shrink-0 border-t border-line px-4 pb-4 pt-4">
        <LanguageSwitcher fullWidth className="mb-4" />
        <UserCard user={user} />
      </div>
    </div>
  );
}

function UserCard({ user }: { user: User }) {
  const { t } = useTranslation('common');
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      toast.error(t('errors.generic', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setSigningOut(false);
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="flex items-center gap-3 border-t border-line pt-4 ps-1">
      <Avatar name={user.full_name} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{user.full_name}</p>
        <Badge tone="forest" size="sm" className="mt-1">
          {t(`enums.role.${user.role}`, { defaultValue: user.role })}
        </Badge>
      </div>
      <IconButton
        label={t('nav.shared.signOut', { defaultValue: 'Sign out' })}
        icon={<LogOut strokeWidth={1.25} />}
        size="sm"
        loading={signingOut}
        onClick={signOut}
        className="text-muted hover:text-ink"
      />
    </div>
  );
}
