import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { FaqEntry } from './faqs';

export interface FaqAccordionProps {
  /** FAQ group id, used to look up translated questions and answers (`faqs.<groupId>.items.<itemId>`). */
  groupId?: string;
  items: readonly FaqEntry[];
  /** Ids open on first render. */
  defaultOpen?: readonly string[];
  className?: string;
}

/**
 * Disclosure accordion (WAI-ARIA pattern): each question is a button in an h3 that controls its
 * answer region. Answers stay in the DOM (prerendered for search engines) and are made inert while closed.
 */
export function FaqAccordion({ groupId, items, defaultOpen = [], className }: FaqAccordionProps) {
  const { t } = useTranslation('marketingInfo');
  const baseId = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(defaultOpen));

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={cn('border-t border-line', className)}>
      {items.map((item) => {
        const isOpen = open.has(item.id);
        const buttonId = `${baseId}-${item.id}-q`;
        const panelId = `${baseId}-${item.id}-a`;
        return (
          <div key={item.id} id={item.id} className="scroll-mt-28 border-b border-line">
            <h3 className="m-0">
              <button
                type="button"
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                className={cn(
                  'group flex w-full items-start justify-between gap-6 py-6 text-start md:py-7',
                  'rounded-sm outline-none focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-gold-500',
                )}
              >
                <span
                  className={cn(
                    'font-display text-[1.3rem] font-bold leading-snug tracking-[-0.01em] transition-colors duration-300 md:text-[1.6rem]',
                    isOpen ? 'text-ink' : 'text-ink group-hover:text-gold-700',
                  )}
                >
                  {groupId ? t(`faqs.${groupId}.items.${item.id}.question`, { defaultValue: item.question }) : item.question}
                </span>
                <span aria-hidden="true" className="mt-1.5 shrink-0 text-gold-700">
                  {isOpen ? <Minus strokeWidth={1.25} className="size-5" /> : <Plus strokeWidth={1.25} className="size-5" />}
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              inert={!isOpen}
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-500 ease-luxe motion-reduce:transition-none',
                isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="overflow-hidden">
                <p className="max-w-measure pb-7 pe-12 text-[15.5px] font-normal leading-relaxed text-ink-2 md:text-base md:leading-relaxed">
                  {groupId ? t(`faqs.${groupId}.items.${item.id}.answer`, { defaultValue: item.answer }) : item.answer}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
