/** Focus sessions and lockdown (FOC-01…FOC-05, FOC-07, FOC-09). */

import { LEVEL_RANK } from '../engine/changes';
import type { FocusSession, PendingChange, ProtectionLevel } from '../engine/types';
import type { SessionRequest, TicketView } from '../shared/models';
import { now } from './clock';
import { globalLevel, groupLevel } from './engine';
import { reconcile } from './reconcile';
import { store } from './store';
import { createTicket, registerExecutor } from './tickets';

const MAX_SESSION_MS = 7 * 24 * 3_600_000;

export async function startSession(req: SessionRequest): Promise<{ id: string }> {
  await store.ready();
  const t0 = now();
  const startAt = t0 + Math.max(0, req.startInMinutes ?? 0) * 60_000;
  let endAt = req.until ?? startAt + Math.max(1, req.minutes ?? 25) * 60_000;
  if (endAt <= startAt) endAt = startAt + 25 * 60_000;
  endAt = Math.min(endAt, startAt + MAX_SESSION_MS);
  const groups =
    req.kind === 'groups'
      ? req.groups.length
        ? req.groups
        : store.config.groups
            .filter((g) => g.enabled && !g.archived && g.options.quickSession)
            .map((g) => g.id)
      : [];
  const session: FocusSession = {
    id: crypto.randomUUID(),
    kind: req.kind,
    groups,
    allow: req.kind === 'allowlist' ? req.allow : [],
    startAt,
    endAt,
    createdAt: t0,
    locked: req.locked,
    noPauses: req.noPauses,
  };
  store.state.sessions.push(session);
  store.usage.count('sessions', t0, store.cc.cal);
  store.scheduleUsage();
  await store.saveState();
  await reconcile('session-start');
  return { id: session.id };
}

/** FOC-05: extending is always possible and immediate. */
export async function extendSession(id: string, minutes: number) {
  await store.ready();
  const s = store.state.sessions.find((x) => x.id === id);
  if (!s || minutes <= 0) return;
  s.endAt = Math.min(s.endAt + minutes * 60_000, s.startAt + MAX_SESSION_MS);
  s.notified = false;
  await store.saveState();
  await reconcile('session-extend');
}

function sessionLevel(s: FocusSession): ProtectionLevel {
  let level = globalLevel();
  for (const id of s.groups) {
    const g = store.config.groups.find((x) => x.id === id);
    if (g) {
      const l = groupLevel(g);
      if (LEVEL_RANK[l] > LEVEL_RANK[level]) level = l;
    }
  }
  return level;
}

/** Ending a session early is a weakening (FOC-03, FOC-05). */
export async function endSession(
  id: string,
): Promise<{ ticket: TicketView | null; refused?: string; pending?: PendingChange }> {
  await store.ready();
  const s = store.state.sessions.find((x) => x.id === id);
  if (!s) return { ticket: null, refused: 'session.error.notFound' };
  const t0 = now();
  if (s.startAt > t0) {
    // Not started yet: cancelling a scheduled session costs like any weakening below.
  }
  if (s.locked) return { ticket: null, refused: 'session.error.locked' };
  const level = sessionLevel(s);
  if (level === 'locked' || level === 'strict') return { ticket: null, refused: 'session.error.strict' };
  const p = store.config.settings.protection;
  const steps =
    level === 'balanced'
      ? [{ type: 'wait' as const, seconds: p.balancedDelaySeconds }]
      : [{ type: 'confirm' as const }];
  const { view } = await createTicket({ kind: 'session.end', id }, steps);
  return { ticket: view };
}

registerExecutor('session.end', async (ticket) => {
  if (ticket.purpose.kind !== 'session.end') return;
  const id = ticket.purpose.id;
  const t0 = now();
  const s = store.state.sessions.find((x) => x.id === id);
  if (!s) return;
  s.endAt = Math.max(s.startAt, Math.min(s.endAt, t0));
  if (s.startAt > t0) store.state.sessions = store.state.sessions.filter((x) => x.id !== id);
  await store.saveState();
  await reconcile('session-end');
});

export function countSessionStop(sessionId: string) {
  const s = store.state.sessions.find((x) => x.id === sessionId) as
    | (FocusSession & { stopped?: number })
    | undefined;
  if (s) {
    s.stopped = (s.stopped ?? 0) + 1;
    store.scheduleState();
  }
}
