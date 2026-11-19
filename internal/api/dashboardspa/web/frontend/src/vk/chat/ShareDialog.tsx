import { useId, useState } from 'react';
import { Modal } from '../../components/Modal';
import type { ChatRow } from '../../hooks/useCardChat';
import { t } from '../../i18n';
import { shareCard, type ChatCard } from '../../supervisor/boardChat';

// BOARD-CHAT Task C5 (owner 19.11 point 4; DOCCHECK DC#32). The card chat is
// private. Richard sees an own card only when the owner presses «Показать
// Ричарду»: a short summary, prefilled from the chat, that the owner has seen
// (and may edit) goes to Richard's city as one topic (`/v1/share`, C2).

/** C2: `/v1/share` takes a summary of 1..600 chars. */
export const SHARE_SUMMARY_MAX = 600;

export interface SharePeer {
  /** «Ричард» */
  name: string;
  /** «Ричарду», or null when people.json has no dative. */
  dative: string | null;
}

/** The card's title, the owner's last question and the last answer, cut to 600 chars. */
export function sharePrefill(title: string, rows: readonly ChatRow[]): string {
  const question = [...rows].reverse().find((r) => r.who === 'owner' && r.text.trim().length > 0);
  const answer = [...rows].reverse().find((r) => r.who !== 'owner' && r.text.trim().length > 0);
  const parts = [title.trim(), question?.text.trim(), answer?.text.trim()].filter(
    (p): p is string => p !== undefined && p.length > 0,
  );
  const text = parts.join('\n');
  return text.length <= SHARE_SUMMARY_MAX ? text : `${text.slice(0, SHARE_SUMMARY_MAX - 1).trimEnd()}…`;
}

export function shareLabel(peer: SharePeer): string {
  return peer.dative !== null ? t('Show {dative}', { dative: peer.dative }) : t('Show to {name}', { name: peer.name });
}

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  city: string;
  card: ChatCard;
  title: string;
  rows: readonly ChatRow[];
  peer: SharePeer;
  onShared: () => void;
}

export function ShareDialog(props: ShareDialogProps) {
  if (!props.open) return null;
  // a fresh prefill each time the dialog opens
  return <ShareForm {...props} />;
}

function ShareForm({ onClose, city, card, title, rows, peer, onShared }: ShareDialogProps) {
  const id = useId();
  const [text, setText] = useState(() => sharePrefill(title, rows));
  const [seen, setSeen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = text.trim();
  const ok = seen && !sending && summary.length > 0 && summary.length <= SHARE_SUMMARY_MAX;
  const label = shareLabel(peer);

  const send = async () => {
    if (!ok) return;
    setSending(true);
    setError(null);
    try {
      await shareCard(city, card, summary);
      onShared();
    } catch {
      setError(t('Not sent — try again.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={label}
      widthClass="max-w-xl"
      footer={
        <button
          type="button"
          onClick={() => void send()}
          disabled={!ok}
          className="min-h-11 rounded-sm border border-vk-border bg-vk-brand px-4 text-base text-vk-on-brand focus-mark disabled:cursor-not-allowed disabled:opacity-50 md:min-h-8"
        >
          {label}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="text-sm text-vk-text-low">
          {t('What {name} will see', { name: peer.name })}
        </label>
        <textarea
          id={id}
          rows={6}
          value={text}
          onFocus={() => setSeen(true)}
          onChange={(e) => {
            setSeen(true);
            setText(e.target.value);
          }}
          className="box-border w-full resize-y rounded-sm border border-vk-border bg-vk-bg-primary p-2 text-base text-vk-text-normal focus-mark"
        />
        <span className="text-[13px] text-vk-text-low">
          {t('{n} of {max} characters', { n: summary.length, max: SHARE_SUMMARY_MAX })}
        </span>
        {error !== null && (
          <p role="alert" className="text-sm text-vk-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
