import { useState } from 'react';
import { canWrite } from '../../embed/activitySession';
import { t } from '../../i18n';
import { isEmbedded } from '../../lib/apiBase';
import { answerErrorText, answerQuestion } from '../../lib/discussWithMayor';
import type { TopicQuestion } from '../../supervisor/peerBoardReads';
import { cn } from '../cn';
import { ExternalLink } from '../ExternalLink';

// BOARD-LIVE L7, owner Q-B: the owner's plain question about a topic, in any
// of its three views. The text is the one or two plain lines, nothing else
// (no ids, no links in the text). Inside the Activity the owner gets the four
// buttons; a click answers THIS question through the Activity's answer route
// (token-verified), never the discuss route. Outside the Activity there is
// only «Ответить в Discord» (the question's message). An Activity reader
// gets neither.

const BUTTON =
  'focus-mark inline-flex min-h-11 items-center rounded-sm border border-vk-border bg-vk-bg-primary px-3 text-sm text-vk-text-high hover:bg-vk-bg-secondary disabled:opacity-50 md:min-h-8';

export function TopicQuestionCard({ question, className }: { question: TopicQuestion; className?: string }) {
  const [sending, setSending] = useState(false);
  const [answered, setAnswered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const embedded = isEmbedded();
  const owner = canWrite();

  const answer = async (index: number) => {
    if (sending || answered !== null) return;
    setSending(true);
    setError(null);
    try {
      await answerQuestion(question.questionId, index);
      setAnswered(question.options[index] ?? '');
    } catch (err) {
      setError(answerErrorText(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      data-testid="topic-question"
      data-question={question.questionId}
      aria-label={t('Question for you')}
      className={cn('flex min-w-0 flex-col gap-2 rounded-sm border border-warn/40 bg-warn/10 p-2', className)}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {question.lines.map((line, i) => (
          <p key={i} data-testid="question-line" className="m-0 text-[15px] text-vk-text-high [overflow-wrap:anywhere]">
            {line}
          </p>
        ))}
      </div>
      {embedded && owner && (
        <div className="flex flex-wrap gap-1.5">
          {question.options.map((label, i) => (
            <button
              key={label}
              type="button"
              disabled={sending || answered !== null}
              onClick={() => void answer(i)}
              className={BUTTON}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!embedded && question.jumpUrl !== null && (
        <ExternalLink href={question.jumpUrl} className={cn(BUTTON, 'self-start')}>
          {t('Answer in Discord')}
        </ExternalLink>
      )}
      {answered !== null && (
        <p role="status" className="m-0 text-sm text-vk-success">
          {t('Answer recorded: {choice}', { choice: answered })}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="m-0 text-sm text-vk-error">
          {error}
        </p>
      )}
    </section>
  );
}
