import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { FileText } from 'lucide-react';
import { PageHero } from '@/components/marketing/PageHero';
import { Tag } from '@/components/marketing/primitives';

export interface LegalSection {
  id: string;
  title: string;
  /** Plain-language summary shown beside the section. */
  summary?: string;
  body: ReactNode;
}

export interface LegalDocumentProps {
  crumb: string;
  title: ReactNode;
  lead: ReactNode;
  /** e.g. "27 October 2026". */
  updated: string;
  sections: readonly LegalSection[];
  /** Link to the sibling document. */
  related: { to: string; label: string };
}

/** Plain-language legal page: light hero, pilot-draft notice, sticky contents and numbered sections. */
export function LegalDocument({ crumb, title, lead, updated, sections, related }: LegalDocumentProps) {
  return (
    <>
      <PageHero
        tone="light"
        size="md"
        crumb={crumb}
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-3">
            <Tag tone="gold">Pilot draft</Tag>
            <span>Last updated {updated}</span>
          </span>
        }
        title={title}
        lead={lead}
      />

      <div className="bg-ivory">
        <div className="content-container grid gap-12 py-14 md:py-20 lg:grid-cols-12 lg:gap-10">
          <aside className="lg:col-span-4 xl:col-span-3">
            <div className="lg:sticky lg:top-28">
              <nav aria-label="On this page">
                <p className="eyebrow eyebrow-rule">On this page</p>
                <ol className="mt-5 flex flex-col gap-1 border-s border-line">
                  {sections.map((section, index) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="-ms-px flex gap-3 border-s border-transparent py-2 ps-4 text-[13px] font-semibold text-muted transition-colors hover:border-gold-500 hover:text-ink"
                      >
                        <span aria-hidden="true" className="font-display text-sm not-italic normal-case tabular-nums tracking-normal text-gold-700">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span>{section.title}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
              <div className="mt-10 border-t border-line pt-6 text-[13.5px] font-normal leading-relaxed text-ink-2">
                <p className="text-[13px] font-semibold text-gold-700">This is a pilot draft.</p>
                <p className="mt-1.5">
                  It describes how MandiMate works during the Madanapalle pilot. It will be reviewed by counsel before
                  general launch, and we will tell registered users before any change takes effect.
                </p>
              </div>
            </div>
          </aside>

          <article className="min-w-0 lg:col-span-8 xl:col-span-8 xl:col-start-5">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="scroll-mt-28 border-t border-line py-10 first:border-t-0 first:pt-0 md:py-12"
              >
                <div className="flex items-baseline gap-4">
                  <span aria-hidden="true" className="font-display text-xl not-italic tabular-nums text-gold-700">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h2
                    id={`${section.id}-title`}
                    className="font-display font-bold text-[1.625rem] leading-tight tracking-[-0.015em] text-ink md:text-[2rem]"
                  >
                    {section.title}
                  </h2>
                </div>
                {section.summary ? (
                  <p className="mt-5 border-s border-gold-500 ps-5 font-display text-[1.15rem] not-italic leading-relaxed text-ink-2">
                    In short: {section.summary}
                  </p>
                ) : null}
                <div className="legal-prose mt-6 flex max-w-measure flex-col gap-4 text-[15.5px] font-normal leading-relaxed text-ink-2 [&_li]:ps-1 [&_strong]:font-medium [&_strong]:text-ink [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:ps-5 [&_ul]:marker:text-gold-700">
                  {section.body}
                </div>
              </section>
            ))}

            <div className="mt-6 flex flex-col gap-4 border-y border-line py-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-3 text-sm font-normal leading-relaxed text-ink-2">
                <FileText aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0 text-muted" />
                <span>
                  Questions about this document? <Link to="/contact" className="link-luxe text-ink">Contact the team</Link>.
                </span>
              </p>
              <Link to={related.to} className="border-b border-current pb-1 text-[13px] font-semibold text-ink transition-colors hover:text-gold-700">
                {related.label} &rarr;
              </Link>
            </div>
          </article>
        </div>
      </div>
    </>
  );
}
