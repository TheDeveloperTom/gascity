import { t, tn } from '../i18n';
import { sessionForBead, type BeadAttentionSession } from '../attention/beadsNeedingAttention';
import type { SupervisorBead } from '../supervisor/beadReads';
import type { BoardCard, BoardModel, RigPrefix } from './boardModel';
import { ownText, type EngineText } from './engineText';
import { isUnlinkedOwnerQuestion } from './ownerQuestions';
import { STAGES, type StageId } from './stageBoard';
import { milestoneOf, waitCauseText, type WaitCause } from './waitReasons';

// Board facts for the owner pages (dashboard v3): «Застряло» (V1), «Мэр
// знает» (V2), current milestones (V4), «Старое, никто не берёт», «Сегодня
// влито». Every fact reads the one board model, so Главная and «Задачи»
// cannot disagree on a count.

export const STUCK_AFTER_MS = 3_600_000;
export const OLD_UNTAKEN_MS = 3 * 86_400_000;
/** V2: Mayor mail older than this does not count as «Мэр знает». */
export const MAYOR_MAIL_WINDOW_MS = 48 * 3_600_000;

export interface StuckItem {
  key: string;
  cardId: string | null;
  title: string;
  reason: EngineText;
  sinceMs: number;
  href: string;
  mayor: 'knows' | 'not-told' | 'unknown';
  mayorEvidence: string | null;
}

export interface FactsContext {
  nowMs: number;
  sessions: readonly BeadAttentionSession[];
  /** Ids named in the Mayor's mail of the last 48 h → the evidence; null when the inbox did not read. */
  mayorMentions: ReadonlyMap<string, string> | null;
}

const ACTIVE_STAGES: ReadonlySet<StageId> = new Set(['working', 'review', 'pr']);
const MAYOR_LABELS: ReadonlySet<string> = new Set([
  'hold:mayor',
  'needs/operator',
  'gc:escalation',
]);
/** City-scoped roles that are never someone's worker (Global Constraints). */
const CITY_ROLES: ReadonlySet<string> = new Set(['bd.dog', 'claude']);

function ms(iso: string | undefined | null): number | null {
  if (iso === undefined || iso === null || iso.length === 0) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function allCards(model: BoardModel): BoardCard[] {
  return STAGES.flatMap((stage) => [...model.columns[stage.id]]);
}

function hasAssignee(bead: SupervisorBead | null | undefined): boolean {
  return (bead?.assignee?.trim() ?? '').length > 0;
}

function beadHref(id: string): string {
  return `/beads?${new URLSearchParams({ bead: id }).toString()}`;
}

function milestoneNumber(milestone: string): number {
  const match = /(\d+)/.exec(milestone);
  return match === null ? Number.POSITIVE_INFINITY : Number(match[1]);
}

function byMilestone(a: string, b: string): number {
  return (
    milestoneNumber(a) - milestoneNumber(b) || a.localeCompare(b, undefined, { numeric: true })
  );
}

function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function closedAtMs(card: BoardCard): number | null {
  const bead = card.node.bead;
  return ms(bead.updated_at ?? bead.created_at);
}

/** A coarse age in the owner's words: «61 мин» → «1 ч», «3 дн.». */
export function ageText(ageMs: number): string {
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) return t('{n} min', { n: minutes });
  const hours = Math.round(ageMs / 3_600_000);
  if (hours < 48) return t('{n} h', { n: hours });
  return t('{n} d', { n: Math.round(ageMs / 86_400_000) });
}

export function lastProgressMs(
  card: BoardCard,
  sessions: readonly BeadAttentionSession[],
): number | null {
  const bead = card.node.bead;
  const step = card.stage.step;
  const candidates = [
    ms(sessionForBead(bead, sessions)?.last_active),
    step === null ? null : ms(sessionForBead(step, sessions)?.last_active),
    step === null ? null : ms(step.updated_at),
    ms(bead.updated_at ?? bead.created_at),
  ].filter((value): value is number => value !== null);
  return candidates.length === 0 ? null : Math.max(...candidates);
}

export function currentMilestones(model: BoardModel, nowMs: number): readonly string[] {
  const cards = allCards(model);
  const current = new Set<string>();
  for (const card of cards) {
    const milestone = milestoneOf(card.node.bead);
    if (milestone === null) continue;
    if (ACTIVE_STAGES.has(card.stage.stage)) current.add(milestone);
    if (card.stage.stage === 'merged') {
      const closed = closedAtMs(card);
      if (closed !== null && sameLocalDay(closed, nowMs)) current.add(milestone);
    }
  }
  if (current.size > 0) return [...current].sort(byMilestone);
  const open = cards
    .filter((card) => card.stage.stage !== 'merged')
    .map((card) => milestoneOf(card.node.bead))
    .filter((m): m is string => m !== null)
    .sort(byMilestone);
  return open.length > 0 && open[0] !== undefined ? [open[0]] : [];
}

/** «Старое, никто не берёт»: ready, unclaimed for 3 days, outside current and later milestones. */
export function oldUntaken(model: BoardModel, nowMs: number): BoardCard[] {
  const current = new Set(currentMilestones(model, nowMs));
  // V4 «never from current or later milestones»: only milestones below the
  // lowest current one are leftovers (review M2).
  const lowest = Math.min(Number.POSITIVE_INFINITY, ...[...current].map(milestoneNumber));
  return model.columns.waiting
    .filter((card) => {
      const bead = card.node.bead;
      if (card.wait?.kind !== 'ready' || hasAssignee(bead)) return false;
      const created = ms(bead.created_at);
      if (created === null || nowMs - created <= OLD_UNTAKEN_MS) return false;
      const milestone = milestoneOf(bead);
      if (milestone === null) return true;
      return !current.has(milestone) && milestoneNumber(milestone) < lowest;
    })
    .sort((a, b) => (ms(a.node.bead.created_at) ?? 0) - (ms(b.node.bead.created_at) ?? 0));
}

/** «Сегодня влито»: merged cards closed on the owner's local day, newest first. */
export function mergedToday(model: BoardModel, nowMs: number): BoardCard[] {
  return model.columns.merged
    .filter((card) => {
      const closed = closedAtMs(card);
      return closed !== null && sameLocalDay(closed, nowMs);
    })
    .sort((a, b) => (closedAtMs(b) ?? 0) - (closedAtMs(a) ?? 0));
}

const ID_IN_TEXT = /(?:stall:)?\b([a-z][a-z0-9]{1,7}-[a-z0-9][a-z0-9-]*(?:\.\d+)*)\b/g;

/** V2: the ids the Mayor's mail of the last 48 h names, each → the mail's subject. */
export function mayorMentionsFrom(
  messages: readonly { subject: string; body?: string; created_at: string }[],
  nowMs: number,
): Map<string, string> {
  const mentions = new Map<string, string>();
  for (const message of messages) {
    const at = ms(message.created_at);
    if (at === null || nowMs - at > MAYOR_MAIL_WINDOW_MS) continue;
    for (const match of `${message.subject}\n${message.body ?? ''}`.matchAll(ID_IN_TEXT)) {
      const id = match[1];
      if (id !== undefined && !mentions.has(id)) mentions.set(id, message.subject);
    }
  }
  return mentions;
}

function mayorOf(
  beads: readonly (SupervisorBead | null | undefined)[],
  ids: readonly string[],
  mentions: ReadonlyMap<string, string> | null,
): Pick<StuckItem, 'mayor' | 'mayorEvidence'> {
  for (const bead of beads) {
    for (const label of bead?.labels ?? []) {
      const name = label.trim();
      if (MAYOR_LABELS.has(name)) {
        return { mayor: 'knows', mayorEvidence: name };
      }
    }
  }
  if (mentions === null) return { mayor: 'unknown', mayorEvidence: null };
  for (const id of ids) {
    const evidence = mentions.get(id);
    if (evidence !== undefined) return { mayor: 'knows', mayorEvidence: evidence };
  }
  return { mayor: 'not-told', mayorEvidence: null };
}

function cardMayor(card: BoardCard, mentions: ReadonlyMap<string, string> | null) {
  const bead = card.node.bead;
  const root = card.stage.root;
  const ids = [bead.id, bead.parent, root?.id].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  return mayorOf([bead, root], ids, mentions);
}

function activeReason(card: BoardCard, ageMs: number): EngineText {
  const bead = card.node.bead;
  const age = ageText(ageMs);
  const routeLive = card.stage.root !== null && card.stage.root.status !== 'closed';
  const nobody = !hasAssignee(bead) && !hasAssignee(card.stage.step) && !routeLive;
  if (card.stage.marks.some((mark) => mark.kind === 'route-stopped')) {
    return ownText(t('Its run stopped; the task stays open for {age}', { age }));
  }
  switch (card.stage.stage) {
    case 'pr': {
      const number = card.stage.pr?.number ?? null;
      if (number === null) return ownText(t('Waiting for a PR, no movement for {age}', { age }));
      // No live key says a PR is a draft, so the reason never says «черновик».
      return ownText(
        nobody
          ? t('PR #{n} is open, nobody is on it for {age}', { n: number, age })
          : t('PR #{n}: no movement for {age}', { n: number, age }),
      );
    }
    case 'review':
      return ownText(t('In review, no movement for {age}', { age }));
    case 'waiting':
    case 'working':
    case 'merged':
      return ownText(
        nobody
          ? t('In progress, nobody is on it for {age}', { age })
          : t('In progress, no movement for {age}', { age }),
      );
  }
}

function causeItem(
  cause: Exclude<WaitCause, { kind: 'no-runs' }>,
  sinceMs: number,
  cardsById: ReadonlyMap<string, BoardCard>,
  mentions: ReadonlyMap<string, string> | null,
): StuckItem {
  switch (cause.kind) {
    case 'card': {
      const card = cardsById.get(cause.blocker.id);
      const title = cause.blocker.title ?? card?.node.bead.title ?? cause.blocker.id;
      // Owner words only: the blocker by its title, never «прогон» or an id.
      const reason =
        cause.milestone !== null
          ? tn(
              cause.tasks,
              {
                one: '{n} task of stage {milestone} waits for «{title}»',
                other: '{n} tasks of stage {milestone} wait for «{title}»',
              },
              { milestone: cause.milestone, title },
            )
          : tn(
              cause.tasks,
              { one: '{n} task waits for «{title}»', other: '{n} tasks wait for «{title}»' },
              { title },
            );
      return {
        key: `idle:card:${cause.blocker.id}`,
        cardId: card === undefined ? null : cause.blocker.id,
        title,
        reason: ownText(reason),
        sinceMs,
        href: beadHref(cause.blocker.id),
        ...(card === undefined
          ? mayorOf([], [cause.blocker.id], mentions)
          : cardMayor(card, mentions)),
      };
    }
    case 'decision':
      return {
        key: `idle:decision:${cause.gate.id}`,
        cardId: null,
        title: cause.gate.title,
        reason: ownText(waitCauseText(cause)),
        sinceMs,
        href: beadHref(cause.gate.id),
        ...mayorOf([], [cause.gate.id], mentions),
      };
    case 'queue':
      return {
        key: `idle:queue:${cause.runHref ?? cause.milestone ?? 'run'}`,
        cardId: null,
        title:
          cause.milestone === null
            ? t('The task queue')
            : t('The queue of stage {milestone}', { milestone: cause.milestone }),
        reason: ownText(
          cause.milestone === null
            ? tn(cause.tasks, {
                one: '{n} task is queued and not started',
                other: '{n} tasks are queued; none has started',
              })
            : waitCauseText(cause),
        ),
        sinceMs,
        href: cause.runHref ?? '/beads',
        mayor: mentions === null ? 'unknown' : 'not-told',
        mayorEvidence: null,
      };
  }
}

/** V1 «Застряло», oldest first. */
export function stuckItems(model: BoardModel, ctx: FactsContext): StuckItem[] {
  const { nowMs } = ctx;
  const items: StuckItem[] = [];
  const keys = new Set<string>();
  const cardIds = new Set<string>();
  const push = (item: StuckItem) => {
    if (keys.has(item.key) || (item.cardId !== null && cardIds.has(item.cardId))) return;
    keys.add(item.key);
    if (item.cardId !== null) cardIds.add(item.cardId);
    items.push(item);
  };
  const cards = allCards(model);
  const cardsById = new Map(cards.map((card) => [card.node.bead.id, card]));

  // V3: a marked owner question with no Discord link cannot be answered, so
  // it never reaches «Тебя ждёт»; it is the Mayor's work to ask again.
  for (const card of cards) {
    const bead = card.node.bead;
    if (!isUnlinkedOwnerQuestion(bead)) continue;
    push({
      key: `unlinked-question:${bead.id}`,
      cardId: bead.id,
      title: bead.title,
      reason: ownText(t('owner question without a link — the Mayor must ask again')),
      sinceMs: ms(bead.updated_at ?? bead.created_at) ?? nowMs,
      href: beadHref(bead.id),
      ...cardMayor(card, ctx.mayorMentions),
    });
  }

  // (a) a card in В работе, Ревью or PR with no progress for over an hour.
  for (const card of cards) {
    if (!ACTIVE_STAGES.has(card.stage.stage)) continue;
    const progress = lastProgressMs(card, ctx.sessions);
    if (progress === null || nowMs - progress <= STUCK_AFTER_MS) continue;
    const bead = card.node.bead;
    push({
      key: `card:${bead.id}`,
      cardId: bead.id,
      title: bead.title,
      reason: activeReason(card, nowMs - progress),
      sinceMs: progress,
      href: beadHref(bead.id),
      ...cardMayor(card, ctx.mayorMentions),
    });
  }

  // (b) an idle cause older than an hour, once per cause.
  if (model.idle.state === 'idle') {
    for (const cause of model.idle.causes) {
      if (cause.kind === 'no-runs') continue;
      const since = ms(cause.since);
      if (since === null || nowMs - since <= STUCK_AFTER_MS) continue;
      push(causeItem(cause, since, cardsById, ctx.mayorMentions));
    }
  }

  // (c) an open, unassigned card that a current-milestone card waits on.
  const current = new Set(currentMilestones(model, nowMs));
  for (const card of model.columns.waiting) {
    const bead = card.node.bead;
    if (bead.status === 'closed' || hasAssignee(bead)) continue;
    const held = (model.waitersOf.get(bead.id) ?? [])
      .map((id) => cardsById.get(id))
      .filter((waiter): waiter is BoardCard => {
        if (waiter === undefined || waiter.stage.stage === 'merged') return false;
        const milestone = milestoneOf(waiter.node.bead);
        return milestone !== null && current.has(milestone);
      });
    if (held.length === 0) continue;
    const since = ms(bead.updated_at ?? bead.created_at);
    if (since === null || nowMs - since <= STUCK_AFTER_MS) continue;
    const first = held[0];
    const reason =
      held.length === 1 && first !== undefined
        ? t('Nobody took it, and «{title}» waits for it', { title: first.node.bead.title })
        : tn(held.length, {
            one: 'Nobody took it, and {n} task waits for it',
            other: 'Nobody took it, and {n} tasks wait for it',
          });
    push({
      key: `blocker:${bead.id}`,
      cardId: bead.id,
      title: bead.title,
      reason: ownText(reason),
      sinceMs: since,
      href: beadHref(bead.id),
      ...cardMayor(card, ctx.mayorMentions),
    });
  }

  return items.sort((a, b) => a.sinceMs - b.sinceMs);
}

/** Service agents never appear on owner pages: no rig, or a city-scoped role. */
// `_rigs` stays in the signature for callers that later need to tell a rig
// path from a city path; a rig field alone decides today, since an agent's
// `rig` may be a filesystem path that the prefix list cannot match.
export function isServiceAgent(
  agent: { name: string; rig?: string | null },
  _rigs: readonly RigPrefix[],
): boolean {
  const rig = agent.rig?.trim() ?? '';
  if (rig.length === 0) return true;
  const role = agent.name.split('/').pop()?.trim() ?? agent.name;
  return CITY_ROLES.has(role);
}

/** A project's name for the owner: the HQ rig, named after the city, is «Город». */
export function projectLabel(rigName: string, cityName: string): string {
  return rigName === cityName ? t('City') : rigName;
}
