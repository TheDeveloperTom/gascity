import type { DashboardSession } from 'gas-city-dashboard-shared';
import { isSessionStreamable } from '../LiveSessionPeek';
import { StructuredLivePeek } from '../StructuredLivePeek';

export function AgentLivePeek({ session }: { session: DashboardSession }) {
  return (
    <section aria-labelledby="agent-live-peek-title">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="agent-live-peek-title" className="text-title font-semibold text-fg">
          Live peek
        </h2>
      </header>
      <StructuredLivePeek sessionId={session.id} stream={isSessionStreamable(session)} showBadge />
    </section>
  );
}
