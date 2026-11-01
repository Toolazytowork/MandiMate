import { useTranslation } from 'react-i18next';
import { Menu } from 'lucide-react';
import { IconButton } from '@/components/ui';
import type { User } from '@/types/api';
import { AiModeChip } from './AiModeChip';
import { Breadcrumbs } from './Breadcrumbs';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';

export interface TopbarProps {
  user: User;
  onOpenNavigation: () => void;
}

/** Ivory bar with a hairline: drawer toggle (< 1024 px), breadcrumbs, AI mode, notifications, account. */
export function Topbar({ user, onOpenNavigation }: TopbarProps) {
  const { t } = useTranslation('common');
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ivory/95">
      <div className="mx-auto flex h-16 w-full max-w-app items-center gap-3 px-4 md:px-8">
        <IconButton
          label={t('a11y.openMenu', { defaultValue: 'Open menu' })}
          icon={<Menu strokeWidth={1.25} />}
          onClick={onOpenNavigation}
          className="-ms-1.5 text-ink lg:hidden"
        />
        <div className="min-w-0 flex-1">
          <Breadcrumbs role={user.role} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          <AiModeChip className="hidden sm:inline-flex" />
          <NotificationBell />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
