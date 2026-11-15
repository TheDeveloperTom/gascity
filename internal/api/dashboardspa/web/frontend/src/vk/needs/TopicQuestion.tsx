import { t } from '../../i18n';
import { mayorChannelUrl } from '../../lib/mayorLink';
import type { TopicQuestion } from '../../supervisor/peerBoardReads';
import { cn } from '../cn';
import { ExternalLink } from '../ExternalLink';

// BOARD-LIVE L7, owner Q-B: the owner's plain question about a topic, in any
// of its three views. The text is the one or two plain lines, nothing else
// (no ids, no links in the text). Owner 16.11 (no Discord Activity): the owner
// answers in Discord on the Mayor's own message, whose buttons prove it is the
// owner; here there is only «Ответить в Discord», never an answer button.

const BUTTON =
  'focus-mark inline-flex min-h-11 items-center rounded-sm border border-vk-border bg-vk-bg-primary px-3 text-sm text-vk-text-high hover:bg-vk-bg-secondary md:min-h-8';

export function TopicQuestionCard({ question, className }: { question: TopicQuestion; className?: string }) {
  // the Mayor's message, else the Mayor's channel
  const href = question.jumpUrl ?? mayorChannelUrl();
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
      {href !== null && (
        <ExternalLink href={href} className={cn(BUTTON, 'self-start')}>
          {t('Answer in Discord')}
        </ExternalLink>
      )}
    </section>
  );
}
