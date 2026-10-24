/**
 * Focus sessions. A session has no protection level: it can be
 * interrupted after a confirmation, or not at all except through the emergency exit.
 */

import { isGroupActive } from '../engine/compile';
import { DEFAULT_SESSION_MINUTES, MAX_SESSION_MS } from '../engine/limits';
import { normalizeFocusLists } from '../engine/schema';
import type { FocusLists, FocusSession } from '../engine/types';
import type { SessionRequest, TicketView } from '../shared/models';
import { now } from './clock';
import { reconcile } from './reconcile';
import { store } from './store';
import { createTicket, registerExecutor } from './tickets';

export async function startSession(req: SessionRequest): Promise<{ id: string }> {
  await store.ready();
  const t0 = now();
  const startAt = t0 + Math.max(0, req.startInMinutes ?? 0) * 60_000;
  let endAt = req.until ?? startAt + Math.max(1, req.minutes ?? DEFAULT_SESSION_MINUTES) * 60_000;
  if (endAt <= startAt) endAt = startAt + DEFAULT_SESSION_MINUTES * 60_000;
  endAt = Math.min(endAt, startAt + MAX_SESSION_MS);
  const groups =
    req.kind === 'groups'
      ? req.groups.length
        ? req.groups
        : store.config.groups.filter((g) => isGroupActive(g) && g.options.quickSession).map((g) => g.id)
      : [];
  const session: FocusSession = {
    id: crypto.randomUUID(),
    kind: req.kind,
    groups,
    allow: req.kind === 'allowlist' ? req.allow : [],
    block: req.kind === 'blocklist' ? (req.block ?? []) : [],
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

/** The lists of the Focus page are kept as they are edited, for the next sessions. */
export async function saveFocusLists(lists: Partial<FocusLists>) {
  await store.ready();
  store.focus = normalizeFocusLists({ ...store.focus, ...lists });
  await store.saveFocus();
}

/** Extending is always possible and immediate. */
export async function extendSession(id: string, minutes: number) {
  await store.ready();
  const s = store.state.sessions.find((x) => x.id === id);
  if (!s || minutes <= 0) return;
  s.endAt = Math.min(s.endAt + minutes * 60_000, s.startAt + MAX_SESSION_MS);
  s.notified = false;
  await store.saveState();
  await reconcile('session-extend');
}

/** Ending a session early, or cancelling one that has not started, costs a confirmation. */
export async function endSession(id: string): Promise<{ ticket: TicketView | null; refused?: string }> {
  await store.ready();
  const s = store.state.sessions.find((x) => x.id === id);
  if (!s) return { ticket: null, refused: 'session.error.notFound' };
  if (s.locked) return { ticket: null, refused: 'session.error.locked' };
  const { view } = await createTicket({ kind: 'session.end', id }, [{ type: 'confirm' }]);
  return { ticket: view };
}

registerExecutor('session.end', async (ticket) => {
  if (ticket.purpose.kind !== 'session.end') return;
  const id = ticket.purpose.id;
  const t0 = now();
  const s = store.state.sessions.find((x) => x.id === id);
  if (!s) return;
  if (s.locked) throw new Error('session.error.locked');
  s.endAt = Math.max(s.startAt, Math.min(s.endAt, t0));
  if (s.startAt > t0) store.state.sessions = store.state.sessions.filter((x) => x.id !== id);
  await store.saveState();
  await reconcile('session-end');
});

/** A page stopped by a focus session, for the summary at its end. */
export function countSessionStop(sessionId: string) {
  const s = store.state.sessions.find((x) => x.id === sessionId);
  if (s) {
    s.stopped = (s.stopped ?? 0) + 1;
    store.scheduleState();
  }
}
