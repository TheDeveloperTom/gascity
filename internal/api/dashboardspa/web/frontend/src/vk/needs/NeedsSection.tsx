import { useCallback, type ComponentProps } from 'react';
import { useSearchParams } from 'react-router';
import { BeadDetailModal } from '../../components/BeadDetailModal';
import { NeedsShelves } from './Shelf';

// Owner 16.11: a question on «Нужно от меня» opens its card in the board's
// right-side drawer on this same page. The list stays where it is (and keeps
// its scroll); the open card is the URL (`?bead=<id>`), so back and reload
// work; Esc or the close button closes it. The list re-reads live data
// (useBoardData refreshes on bead events), so an answered question drops out.

type ShelvesProps = Omit<ComponentProps<typeof NeedsShelves>, 'onOpenBead'>;

export function NeedsSection(props: ShelvesProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('bead');
  const beadId = raw !== null && raw.trim() !== '' ? raw.trim() : null;

  const select = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === null) next.delete('bead');
          else next.set('bead', id);
          return next;
        },
        { preventScrollReset: true },
      );
    },
    [setSearchParams],
  );
  const open = useCallback((id: string) => select(id), [select]);
  const close = useCallback(() => select(null), [select]);

  return (
    <>
      <NeedsShelves {...props} onOpenBead={open} />
      {/* Mounted only while a card is open: closed, it reads nothing. */}
      {beadId !== null && (
        <BeadDetailModal open onClose={close} beadId={beadId} onOpenBead={open} />
      )}
    </>
  );
}
