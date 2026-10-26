/** Statistics: queries, export and deletion. Only daily aggregates exist, with the hours of the total. */

import { BUDGET_KEEP_DAYS } from '../engine/limits';
import { addDays, dayKey, dayStartAt, logicalDayOf, parseDayKey } from '../engine/time';
import type { DayRecord } from '../engine/types';
import { displayHost, stripWww } from '../engine/url';
import { impulsesOf, usageKeys } from '../engine/usage';
import { api } from '../platform/api';
import { timestampSuffix } from '../shared/format';
import type { StatsDay, StatsModel } from '../shared/models';
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

/** Sites that the days split their time by; the rest is "other sites". */
export const STACK_SITES = 6;

/**
 * Time of a day's total that its sites leave out, from which a day without a total for private
 * windows is taken to have one: the versions before 1.1.0 counted the time in private windows only
 * in the total. Less is the rounding of those versions, whose sites had clocks of their own.
 */
export const EARLIER_PRIVATE_SECONDS = 60;

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
  const unnamed = { seconds: 0, visits: 0 };
  const counters = { shown: 0, proceeded: 0, left: 0, pauses: 0, pauseMinutes: 0, sessions: 0, impulses: 0 };
  for (const d of days) {
    const rec = records.get(d);
    if (!rec) continue;
    counters.impulses += impulsesOf(rec.c);
    for (const [key, [s, v]] of Object.entries(rec.t)) {
      if (key.startsWith('g:')) {
        const g = groups.get(key.slice(2)) ?? { seconds: 0, visits: 0 };
        g.seconds += s;
        g.visits += v;
        groups.set(key.slice(2), g);
      } else if (key.startsWith('h:')) {
        // The time without a site is among the other sites.
        const host = key.slice(2);
        const h = (host ? sites.get(host) : unnamed) ?? { seconds: 0, visits: 0 };
        h.seconds += s;
        h.visits += v;
        if (host) sites.set(host, h);
      }
    }
    for (const [name, n] of Object.entries(rec.c)) {
      const kind = name.split(':')[0];
      if (kind === 'shown') counters.shown += n;
      // Passes, and breaks taken from an intervention page.
      else if (kind === 'proceeded' || kind === 'pausedIn') counters.proceeded += n;
      else if (kind === 'left') counters.left += n;
      else if (kind === 'pause') counters.pauses += n;
      else if (kind === 'pauseMin') counters.pauseMinutes += n;
      else if (kind === 'sessions') counters.sessions += n;
    }
  }

  const siteList = [...sites.entries()]
    .map(([host, v]) => ({ host, ...v }))
    .sort((a, b) => b.seconds - a.seconds);
  const stack = siteList.slice(0, STACK_SITES).map((x) => x.host);
  /**
   * A day's time on limited sites and outside the rules, and the same time by site: the two add up,
   * whatever days of earlier versions hold.
   */
  const dayOf = (day: string): StatsDay => {
    const t = records.get(day)?.t ?? {};
    const own = stack.map((host) => t[usageKeys.host(host)]?.[0] ?? 0);
    let all = 0;
    for (const [key, [sec]] of Object.entries(t)) if (key.startsWith('h:')) all += sec;
    const limited = t[usageKeys.all]?.[0] ?? 0;
    const outside = t[usageKeys.outside]?.[0] ?? 0;
    let priv = t[usageKeys.private]?.[0] ?? 0;
    let rest = Math.max(0, limited + outside - all - priv);
    if (!t[usageKeys.private] && rest >= EARLIER_PRIVATE_SECONDS) {
      priv += rest;
      rest = 0;
    }
    // The rest has no site: among the other sites, as the time without a site.
    unnamed.seconds += rest;
    const otherSites = Math.max(0, all - own.reduce((a, b) => a + b, 0)) + rest;
    return {
      day,
      // More than the time on limited sites only on days of earlier versions, whose sites could count
      // more: tabs open at the same time, sites outside the rules.
      seconds: Math.max(limited, all + priv + rest - outside),
      visits: t[usageKeys.all]?.[1] ?? 0,
      outside,
      sites: own,
      otherSites,
      private: priv,
    };
  };
  const byDay = days.map(dayOf);

  let hours: number[] | null = Array(24).fill(0);
  for (const d of days) {
    const rec = records.get(d);
    if (!rec?.t[usageKeys.all]?.[0]) continue;
    if (!rec.h) {
      hours = null;
      break;
    }
    for (const [hk, sec] of Object.entries(rec.h)) hours[Number(hk)] += sec;
  }

  // The breaks and the reasons of the same logical days as the totals.
  const fromMs = dayStartAt(parseDayKey(from), store.cc.cal);
  const toMs = dayStartAt(addDays(parseDayKey(to), 1), store.cc.cal);
  const names = new Map(store.config.groups.map((g) => [g.id, g]));
  return {
    from,
    to,
    days: byDay,
    total: {
      seconds: sumKey(records, days, usageKeys.all, 0),
      visits: [...groups.values()].reduce((a, g) => a + g.visits, 0),
    },
    previous: { seconds: sumKey(records, prevDays, usageKeys.all, 0), visits: 0 },
    groups: [...groups.entries()]
      .map(([id, v]) => ({
        id,
        name: names.get(id)?.name ?? '',
        color: names.get(id)?.color ?? '#888888',
        ...v,
      }))
      .sort((a, b) => b.seconds - a.seconds),
    sites: siteList.slice(0, 100),
    siteTotal: {
      count: siteList.length,
      seconds: siteList.reduce((a, x) => a + x.seconds, unnamed.seconds),
      visits: siteList.reduce((a, x) => a + x.visits, unnamed.visits),
    },
    private: {
      seconds: byDay.reduce((a, d) => a + d.private, 0),
      visits: sumKey(records, days, usageKeys.private, 1),
    },
    stack,
    counters,
    pauses: store.state.pauses
      .filter((p) => p.at >= fromMs && p.at < toMs)
      .map((p) => ({
        at: p.at,
        groups: p.groups === '*' ? ['*'] : p.groups,
        scope: p.scope,
        site: p.site,
        url: p.url,
        minutes: p.minutes,
        reason: p.reason,
        used: p.used,
      }))
      .reverse(),
    intentions: store.intentions.filter((i) => i.at >= fromMs && i.at < toMs).reverse(),
    hours,
  };
}

/** The kind of each usage key in the CSV export. */
const CSV_KINDS: Record<string, string> = {
  g: 'group',
  s: 'group-site',
  h: 'site',
  p: 'private',
  o: 'outside-rules',
  a: 'all-limited',
};

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
      rows.push([
        day,
        CSV_KINDS[kind] ?? 'all-limited',
        id,
        kind === 'g' ? (names.get(id) ?? '') : '',
        String(Math.round(s)),
        String(v),
      ]);
    }
    for (const [hour, sec] of Object.entries(rec.h ?? {}))
      rows.push([day, 'hour', hour, '', String(Math.round(sec)), '']);
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

/** Deletes all statistics, a range of days, or one site everywhere. */
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
      // Break records stay for break limits, without the reasons and the sites.
      const since = Date.now() - BUDGET_KEEP_DAYS * 86_400_000;
      store.state.pauses = store.state.pauses
        .filter((p) => p.at >= since)
        .map(({ reason: _r, site: _s, url: _u, ...p }) => p);
      store.intentions = [];
      await store.saveIntentions();
      await store.saveState();
      await store.flushUsage();
    }
  } else if (scope === 'site' && host) {
    const records = await store.loadDays(keys);
    const items: Record<string, DayRecord> = {};
    for (const [day, rec] of records) {
      const time = rec.t[usageKeys.host(host)];
      if (!time) continue;
      // Its time stays among the other sites, without a site, so that the sites add up to the total.
      delete rec.t[usageKeys.host(host)];
      const unnamed = rec.t[usageKeys.host('')] ?? [0, 0];
      rec.t[usageKeys.host('')] = [unnamed[0] + time[0], unnamed[1] + time[1]];
      items[`u:${day}`] = rec;
    }
    if (Object.keys(items).length) await api.storage.local.set(items);
    // The breaks taken on the site no longer say where.
    const site = stripWww(host);
    let changed = false;
    store.state.pauses = store.state.pauses.map((p) => {
      if (p.site !== site && !(p.url && displayHost(p.url) === site)) return p;
      changed = true;
      const { site: _s, url: _u, ...rest } = p;
      return rest;
    });
    if (changed) await store.saveState();
  }
  broadcast(['usage']);
}

/** Retention: statistics older than the configured period are deleted (budget data kept, see above). */
export async function applyRetention() {
  const keys = await store.allDayKeys();
  const today = logicalDayOf(Date.now(), store.cc.cal);
  const cutoff = dayKey(addDays(today, -store.config.settings.tracking.retentionDays));
  await stripDays(keys.filter((k) => k < cutoff));
}
