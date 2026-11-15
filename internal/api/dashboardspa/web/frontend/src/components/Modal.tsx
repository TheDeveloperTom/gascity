import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Optional caption next to the title. */
  caption?: ReactNode;
  children: ReactNode;
  /** Optional footer slot (e.g. action buttons). */
  footer?: ReactNode;
  /** When set, render the modal at the given max-width class instead of the default. */
  widthClass?: string;
}

// A white panel on a scrim. The scrim is its own token (`--scrim`, used at
// 50 %) so the backdrop darkens in both themes; the old `bg-fg/30` turned
// light grey in dark mode. The panel is the dialog; the overlay around it
// closes on click. The × comes first in the DOM so it is the first "Close"
// a keyboard or a test meets.
export function Modal({
  open,
  onClose,
  title,
  caption,
  children,
  footer,
  widthClass = 'max-w-3xl',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim/50 p-4 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[90vh] w-full ${widthClass} flex-col rounded-lg border border-rule bg-surface-raised text-fg shadow-overlay`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-fg [overflow-wrap:anywhere]">{title}</h2>
            {caption && (
              <p className="mt-0.5 text-label text-fg-muted [overflow-wrap:anywhere]">{caption}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-xl leading-none text-fg-muted transition-colors duration-150 ease-out-quart hover:bg-surface-tint hover:text-fg focus-mark"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4 text-body text-fg">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
