import { useCallback, useEffect, useState } from 'react';
import { formatApiError } from '../../api/client';
import {
  READ_ONLY_CONTROL_TITLE,
  ReadOnlyBadge,
  useReadOnly,
} from '../../contexts/ReadOnlyContext';
import { useOperatorConfig } from '../../contexts/OperatorConfigContext';
import { useViewingAs } from '../../contexts/ViewingAsContext';
import { displayLabel } from '../../hooks/aliasPriority';
import { sendSupervisorMail } from '../../supervisor/mailWrites';
import { Button } from '../Button';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { StatusBadge } from '../StatusBadge';

// Input recipe (DESIGN-PLAN §7); the fill differs between the editable
// fields and the fixed sender.
const INPUT_CLASS =
  'h-9 w-full rounded border border-rule px-3 text-body placeholder:text-fg-faint focus-mark';

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}

export function ComposeModal({ open, onClose, onSent }: ComposeModalProps) {
  const { viewingAs } = useViewingAs();
  const readOnly = useReadOnly();
  const { operatorAlias: OPERATOR_ALIAS, operatorWireAlias } = useOperatorConfig();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTo('');
      setSubject('');
      setBody('');
      setError(null);
    }
  }, [open]);

  const onSend = useCallback(async () => {
    // Defense-in-depth: the disabled Send button already blocks this, but a
    // keyboard/programmatic path must never reach a write the server 405s.
    if (readOnly) return;
    setSending(true);
    setError(null);
    try {
      await sendSupervisorMail({ to, subject, body }, operatorWireAlias);
      onSent();
    } catch (err) {
      setError(formatApiError(err, 'send failed'));
    } finally {
      setSending(false);
    }
  }, [body, onSent, readOnly, subject, to, operatorWireAlias]);

  const canSend =
    !readOnly &&
    viewingAs.isOperator &&
    to.length > 0 &&
    subject.length > 0 &&
    body.length > 0 &&
    !sending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New message"
      caption="Sends from the operator. Reading-as has no effect on the sender."
      widthClass="max-w-2xl"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="accent"
            size="sm"
            disabled={!canSend}
            title={readOnly ? READ_ONLY_CONTROL_TITLE : undefined}
            onClick={() => void onSend()}
          >
            {sending ? 'Sending' : 'Send'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="From" variant="form">
          <input
            type="text"
            value={
              viewingAs.isOperator
                ? displayLabel(OPERATOR_ALIAS, OPERATOR_ALIAS)
                : `${displayLabel(OPERATOR_ALIAS, OPERATOR_ALIAS)} (reading-as does not change sender)`
            }
            disabled
            className={`${INPUT_CLASS} cursor-not-allowed bg-surface-tint text-fg-muted`}
          />
        </Field>
        <Field label="To (alias)" variant="form">
          <input
            type="text"
            autoFocus
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="mayor, mechanic, scix-worker, …"
            className={`${INPUT_CLASS} bg-surface-raised text-fg`}
          />
        </Field>
        <Field label="Subject" variant="form">
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            className={`${INPUT_CLASS} bg-surface-raised text-fg`}
          />
        </Field>
        <Field label="Body" variant="form">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            maxLength={16 * 1024}
            className="w-full resize-y rounded border border-rule bg-surface-raised px-3 py-2 text-reading text-fg placeholder:text-fg-faint focus-mark"
          />
        </Field>
        {readOnly && <ReadOnlyBadge />}
        {!viewingAs.isOperator && (
          <StatusBadge
            tone="warn"
            variant="inline"
            wrap
            label={`Reading as ${displayLabel(viewingAs.alias, OPERATOR_ALIAS)}. Sends from this modal are structurally locked to the operator regardless.`}
          />
        )}
        {error && <StatusBadge tone="stuck" variant="inline" wrap label={error} />}
      </div>
    </Modal>
  );
}
