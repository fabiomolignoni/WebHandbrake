/** Statistics (STA-01…STA-07): queries, export and deletion. Only daily aggregates exist. */

import { BUDGET_KEEP_DAYS } from '../engine/limits';
import { addDays, dayKey, logicalDayOf, parseDayKey } from '../engine/time';
import type { DayRecord } from '../engine/types';
import { api } from '../platform/api';
import { timestampSuffix } from '../shared/format';
import type { StatsModel } from '../shared/models';
import { broadcast } from './reconcile';
import { store } from './store';

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = parseDayKey(from);
  const end = dayKey(parseDayKey(to));
  for (let i = 0; i < 3700; i++) {
    const k = dayKey(d);
    out.push(k);
    if (k === end) break;
    d = addDays(d, 1);
  }
  return out;
}

function sumKey(records: Map<string, DayRecord>, days: string[], key: string, field: 0 | 1) {
  let n = 0;
  for (const d of days) n += records.get(d)?.t[key]?.[field] ?? 0;
  return n;
}

export async function getStats(from: string, to: string): Promise<StatsModel> {
  await store.ready();
  await store.flushUsage();
  const days = daysBetween(from, to);
  const span = days.length;
  const prevDays = daysBetween(
    dayKey(addDays(parseDayKey(from), -span)),
    dayKey(addDays(parseDayKey(from), -1)),
  );
  const records = await store.loadDays([...days, ...prevDays]);

  const groups = new Map<string, { seconds: number; visits: number }>();
  const sites = new Map<string, { seconds: number; visits: number }>();
  const counters = { shown: 0, proceeded: 0, left: 0, pauses: 0, pauseMinutes: 0, sessions: 0, impulses: 0 };
  for (const d of days) {
    const rec = records.get(d);
    if (!rec) continue;
    for (const [key, [s, v]] of Object.entries(rec.t)) {
      if (key.startsWith('g:')) {
        const g = groups.get(key.slice(2)) ?? { seconds: 0, visits: 0 };
        g.seconds += s;
        g.visits += v;
        groups.set(key.slice(2), g);
      } else if (key.startsWith('h:')) {
        const h = sites.get(key.slice(2)) ?? { seconds: 0, visits: 0 };
        h.seconds += s;
        h.visits += v;
        sites.set(key.slice(2), h);
      }
    }
    for (const [name, n] of Object.entries(rec.c)) {
      const kind = name.split(':')[0];
      if (kind === 'shown') counters.shown += n;
      else if (kind === 'proceeded') counters.proceeded += n;
      else if (kind === 'left') counters.left += n;
      else if (kind === 'pause') counters.pauses += n;
      else if (kind === 'pauseMin') counters.pauseMinutes += n;
      else if (kind === 'sessions') counters.sessions += n;
    }
  }
  counters.impulses = Math.max(0, counters.shown - counters.proceeded);

  const fromMs = new Date(parseDayKey(from).y, parseDayKey(from).m, parseDayKey(from).d).getTime();
  const toDay = addDays(parseDayKey(to), 1);
  const toMs = new Date(toDay.y, toDay.m, toDay.d).getTime();
  const names = new Map(store.config.groups.map((g) => [g.id, g]));
  return {
    from,
    to,
    days: days.map((d) => ({
      day: d,
      seconds: sumKey(records, [d], 'a:', 0),
      visits: sumKey(records, [d], 'a:', 1),
    })),
    total: {
      seconds: sumKey(records, days, 'a:', 0),
      visits: [...groups.values()].reduce((a, g) => a + g.visits, 0),
    },
    previous: { seconds: sumKey(records, prevDays, 'a:', 0), visits: 0 },
    groups: [...groups.entries()]
      .map(([id, v]) => ({
        id,
        name: names.get(id)?.name ?? '',
        color: names.get(id)?.color ?? '#888888',
        ...v,
      }))
      .sort((a, b) => b.seconds - a.seconds),
    sites: [...sites.entries()]
      .map(([host, v]) => ({ host, ...v }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 100),
    counters,
    pauses: store.state.pauses
      .filter((p) => p.at >= fromMs && p.at < toMs)
      .map((p) => ({
        at: p.at,
        groups: p.groups === '*' ? ['*'] : p.groups,
        scope: p.scope,
        minutes: p.minutes,
        reason: p.reason,
        used: p.used,
      }))
      .reverse(),
    intentions: store.intentions.filter((i) => i.at >= fromMs && i.at < toMs).reverse(),
    hours: [],
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportStats(format: 'csv' | 'json') {
  await store.ready();
  await store.flushUsage();
  const keys = await store.allDayKeys();
  const records = await store.loadDays(keys);
  const names = new Map(store.config.groups.map((g) => [g.id, g.name]));
  const suffix = timestampSuffix();
  if (format === 'json') {
    return {
      filename: `webhandbrake-statistics-${suffix}.json`,
      mime: 'application/json',
      text: JSON.stringify(
        {
          format: 'webhandbrake-statistics',
          version: 1,
          days: Object.fromEntries(records),
          pauses: store.state.pauses,
          intentions: store.intentions,
        },
        null,
        2,
      ),
    };
  }
  const rows = [['day', 'kind', 'id', 'name', 'seconds', 'visits']];
  for (const [day, rec] of [...records.entries()].sort()) {
    for (const [key, [s, v]] of Object.entries(rec.t)) {
      const [kind, ...rest] = key.split(':');
      const id = rest.join(':');
      const label =
        kind === 'g' ? 'group' : kind === 's' ? 'group-site' : kind === 'h' ? 'site' : 'all-limited';
      rows.push([
        day,
        label,
        id,
        kind === 'g' ? (names.get(id) ?? '') : '',
        String(Math.round(s)),
        String(v),
      ]);
    }
    for (const [name, n] of Object.entries(rec.c)) rows.push([day, 'counter', name, '', '', String(n)]);
  }
  return {
    filename: `webhandbrake-statistics-${suffix}.csv`,
    mime: 'text/csv',
    text: rows.map((r) => r.map(csvCell).join(',')).join('\n'),
  };
}

/**
 * Usage that limits depend on is kept even when statistics are deleted, otherwise deleting
 * statistics would refill exhausted budgets: group and group-site totals, passes (increasing
 * delays) and break records, for BUDGET_KEEP_DAYS (the longest limit period plus a margin).
 */

function budgetOnly(rec: DayRecord): DayRecord {
  return {
    t: Object.fromEntries(Object.entries(rec.t).filter(([k]) => k.startsWith('g:') || k.startsWith('s:'))),
    c: Object.fromEntries(Object.entries(rec.c).filter(([k]) => k.startsWith('proceeded:'))),
  };
}

function budgetCutoff(): string {
  return dayKey(addDays(logicalDayOf(Date.now(), store.cc.cal), -BUDGET_KEEP_DAYS));
}

/** Removes the given days, keeping only budget data for the recent ones. */
async function stripDays(days: string[]) {
  const cutoff = budgetCutoff();
  const recent = days.filter((d) => d >= cutoff);
  const old = days.filter((d) => d < cutoff);
  if (old.length) {
    await api.storage.local.remove(old.map((k) => `u:${k}`));
    for (const k of old) store.usage.days.delete(k);
  }
  if (recent.length) {
    const records = await store.loadDays(recent);
    const items: Record<string, DayRecord> = {};
    for (const [day, rec] of records) {
      const kept = budgetOnly(rec);
      items[`u:${day}`] = kept;
      if (store.usage.days.has(day)) store.usage.days.set(day, kept);
    }
    if (Object.keys(items).length) await api.storage.local.set(items);
  }
}

/** STA-06: deletes all statistics, a range of days, or one site everywhere. */
export async function deleteStats(
  scope: 'all' | 'range' | 'site',
  from?: string,
  to?: string,
  host?: string,
) {
  await store.ready();
  await store.flushUsage();
  const keys = await store.allDayKeys();
  if (scope === 'all' || scope === 'range') {
    const del = scope === 'all' ? keys : keys.filter((k) => from && to && k >= from && k <= to);
    await stripDays(del);
    if (scope === 'all') {
      delete store.usage.minutes['a:'];
      store.usage.dirtyMinutes = true;
      // Break records stay for break limits, without the reasons.
      const since = Date.now() - BUDGET_KEEP_DAYS * 86_400_000;
      store.state.pauses = store.state.pauses.filter((p) => p.at >= since).map(({ reason: _r, ...p }) => p);
      store.intentions = [];
      await store.saveIntentions();
      await store.saveState();
      await store.flushUsage();
    }
  } else if (scope === 'site' && host) {
    const records = await store.loadDays(keys);
    const items: Record<string, DayRecord> = {};
    for (const [day, rec] of records) {
      if (rec.t[`h:${host}`]) {
        delete rec.t[`h:${host}`];
        items[`u:${day}`] = rec;
      }
    }
    if (Object.keys(items).length) await api.storage.local.set(items);
  }
  broadcast(['usage']);
}

/** Retention (STA-01): statistics older than the configured period are deleted (budget data kept, see above). */
export async function applyRetention() {
  const keys = await store.allDayKeys();
  const today = logicalDayOf(Date.now(), store.cc.cal);
  const cutoff = dayKey(addDays(today, -store.config.settings.tracking.retentionDays));
  await stripDays(keys.filter((k) => k < cutoff));
}
