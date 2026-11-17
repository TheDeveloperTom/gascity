import { t } from '../../i18n';
import { attachmentUrls, prepareCardText } from '../../lib/cardText';
import { MARKDOWN_CLASS, renderMiniMarkdown } from '../../lib/miniMarkdown';

// Owner 17.11: one renderer for a card's description in our own drawer and in
// a peer's: section headings, a checklist, inline code, machine lines under a
// closed «Подробнее», and the card's screenshots as thumbnails.

export interface CardDescriptionProps {
  text: string;
  beadId: string;
  /** Our city's name; a peer card has none, so its stored files are not served. */
  city?: string | undefined;
  metadata?: Readonly<Record<string, string>> | undefined;
  /** The level a `#` heading renders at (inside a drawer the title is an h2). */
  headingFrom?: 1 | 2 | 3;
  className?: string;
}

export function CardDescription({
  text,
  beadId,
  city,
  metadata,
  headingFrom = 1,
  className = 'text-base text-vk-text-normal',
}: CardDescriptionProps) {
  const prepared = prepareCardText(text);
  const images = [...attachmentUrls(metadata, { city, beadId }), ...prepared.images];
  return (
    <div data-testid="task-description" className={`${className} ${MARKDOWN_CLASS}`}>
      {renderMiniMarkdown(prepared.body, { headingFrom })}
      {images.length > 0 && (
        <ul aria-label={t('Screenshots')} className="!list-none !pl-0 flex flex-wrap gap-2">
          {images.map((src, i) => (
            <li key={src}>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('Screenshot {n}', { n: i + 1 })}
                className="block overflow-hidden rounded-sm border border-vk-border focus-mark hover:border-vk-text-low"
              >
                {src.startsWith('/') ? (
                  <img src={src} alt="" loading="lazy" className="h-28 w-auto max-w-[220px] object-cover" />
                ) : (
                  // The page's CSP allows same-origin images only: an outside
                  // image is a link to open, not a broken thumbnail.
                  <span className="block px-2 py-1 text-sm underline">{t('Screenshot {n}', { n: i + 1 })}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
      {prepared.details.length > 0 && (
        <details className="text-sm text-vk-text-low">
          <summary className="cursor-pointer select-none">{t('More details')}</summary>
          <div className="mt-1 flex flex-col gap-0.5">
            {prepared.details.map((line, i) => (
              <div key={i}>{renderMiniMarkdown(line)}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
