/**
 * Insights: day, week, month, year; per group and per site; the hours of a day, the days of
 * a period (in total or by site), and comparison with the previous period; attempts and
 * pauses; neutral language.
 * Charts always have text labels and a table alternative.
 */

import { useState } from 'preact/hooks';
import { BUDGET_KEEP_DAYS } from '../../engine/limits';
import { addDays, dayKey, HOUR, logicalDayOf, parseDayKey, weekdayOf } from '../../engine/time';
import { t } from '../../i18n/i18n';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatHour,
  formatPercent,
  formatTime,
} from '../../shared/format';
import type { StatsDay, StatsModel } from '../../shared/models';
import { call } from '../../shared/rpc';
import {
  Button,
  ColorDot,
  Dialog,
  Empty,
  IconButton,
  Menu,
  Segmented,
  Spinner,
  toast,
} from '../../ui/components';
import { downloadText } from '../../ui/download';
import { useModel } from '../../ui/hooks';
import { breakSubject } from '../../ui/pause';
import { useDashboard } from '../context';

type Span = 'day' | 'week' | 'month' | 'year';

function rangeFor(
  span: Span,
  offset: number,
  cal: { dayStart: number; weekStart: number },
): { from: string; to: string } {
  const today = logicalDayOf(Date.now(), cal);
  switch (span) {
    case 'day': {
      const d = addDays(today, offset);
      return { from: dayKey(d), to: dayKey(d) };
    }
    case 'week': {
      const back = (weekdayOf(today) - cal.weekStart + 7) % 7;
      const first = addDays(today, -back + offset * 7);
      return { from: dayKey(first), to: dayKey(addDays(first, 6)) };
    }
    case 'month': {
      const first = new Date(today.y, today.m + offset, 1);
      const last = new Date(today.y, today.m + offset + 1, 0);
      return {
        from: dayKey({ y: first.getFullYear(), m: first.getMonth(), d: 1 }),
        to: dayKey({ y: last.getFullYear(), m: last.getMonth(), d: last.getDate() }),
      };
    }
    case 'year':
      return { from: `${today.y + offset}-01-01`, to: `${today.y + offset}-12-31` };
  }
}

function rangeLabel(span: Span, r: { from: string; to: string }) {
  const f = parseDayKey(r.from);
  const from = new Date(f.y, f.m, f.d).getTime();
  const tt = parseDayKey(r.to);
  const to = new Date(tt.y, tt.m, tt.d).getTime();
  if (span === 'day') return formatDate(from, { weekday: 'long', day: 'numeric', month: 'long' });
  if (span === 'month') return formatDate(from, { month: 'long', year: 'numeric' });
  if (span === 'year') return String(f.y);
  return `${formatDate(from)} – ${formatDate(to)}`;
}

function dayLabel(key: string, count: number): string {
  if (key.length === 7) {
    const [y, m] = key.split('-').map(Number);
    return formatDate(new Date(y, m - 1, 1).getTime(), { month: 'short' });
  }
  const d = parseDayKey(key);
  const ms = new Date(d.y, d.m, d.d).getTime();
  return count <= 7 ? formatDate(ms, { weekday: 'short' }) : String(d.d);
}

interface Column {
  key: string;
  /** Axis label; empty for none. */
  label: string;
  /** Hidden on narrow screens. */
  minor?: boolean;
  /** Name in the table and the tooltip. */
  name: string;
  seconds: number;
  /** Seconds per series, for a stacked column. */
  parts?: number[];
  current?: boolean;
}

/** Colour of series i, the last one being "other sites". */
function seriesColor(i: number, count: number) {
  return i === count - 1 ? 'var(--series-other)' : `var(--series-${i + 1})`;
}

/** Columns of time, stacked by series when given, with a table alternative. */
function Columns({
  columns,
  label,
  head,
  series,
  spread,
}: {
  columns: Column[];
  label: string;
  head: string;
  series?: string[];
  /** Labels only every few columns, which may run over the empty ones. */
  spread?: boolean;
}) {
  const [table, setTable] = useState(false);
  const total = (c: Column) => (c.parts ? c.parts.reduce((a, b) => a + b, 0) : c.seconds);
  const max = Math.max(1, ...columns.map(total));
  // A series that has no time in the period is not in the legend.
  const shown = series?.map((_, i) => columns.some((c) => (c.parts?.[i] ?? 0) > 0));
  return (
    <div class="stack stack-sm">
      {!table ? (
        <>
          <div class="chart">
            <div class="axis" aria-hidden="true">
              <span>{formatDuration(max)}</span>
              <span>{formatDuration(max / 2)}</span>
              <span>0</span>
            </div>
            <div>
              <div class="bars" role="img" aria-label={label}>
                {columns.map((c) => {
                  const sum = total(c);
                  return (
                    <div class="col" key={c.key}>
                      {c.parts && sum > 0 ? (
                        <div class="stacked" style={{ height: `${(sum / max) * 100}%` }}>
                          {c.parts.map((p, i) =>
                            p > 0 ? (
                              <div
                                key={i}
                                style={{ flexGrow: p, background: seriesColor(i, c.parts?.length ?? 0) }}
                                title={`${c.name} · ${series?.[i]}: ${formatDuration(p)}`}
                              />
                            ) : null,
                          )}
                        </div>
                      ) : (
                        <div
                          class={`bar${sum ? '' : ' empty-bar'}${c.current && !c.parts ? ' today' : ''}`}
                          style={{ height: `${Math.max(2, (sum / max) * 100)}%` }}
                          title={`${c.name}: ${formatDuration(sum)}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div class={`bar-labels${spread ? ' spread' : ''}`} aria-hidden="true">
                {columns.map((c) => (
                  <span key={c.key} class={c.minor ? 'minor' : undefined}>
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {series && (
            <ul class="legend small" aria-label={t('insights.legend')}>
              {series.map((name, i) =>
                shown?.[i] ? (
                  <li key={name}>
                    <span class="key" style={{ background: seriesColor(i, series.length) }} />
                    {name}
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </>
      ) : (
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>{head}</th>
                {series?.map((name, i) =>
                  shown?.[i] ? (
                    <th key={name} class="num">
                      {name}
                    </th>
                  ) : null,
                )}
                <th class="num">{series ? t('insights.total.column') : t('insights.time')}</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.key}>
                  <td>{c.name}</td>
                  {c.parts?.map((p, i) =>
                    shown?.[i] ? (
                      <td key={i} class="num">
                        {formatDuration(p)}
                      </td>
                    ) : null,
                  )}
                  <td class="num">{formatDuration(total(c))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        class="link-btn small"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setTable(!table)}
      >
        {table ? t('insights.showChart') : t('insights.showTable')}
      </button>
    </div>
  );
}

type TrendMode = 'total' | 'sites';

function Trend({
  s,
  span,
  cal,
  mode,
  onMode,
}: {
  s: StatsModel;
  span: Span;
  cal: { dayStart: number; weekStart: number };
  mode: TrendMode;
  onMode: (m: TrendMode) => void;
}) {
  // A year is shown month by month, the other periods day by day.
  const months = span === 'year';
  const days = months ? monthly(s) : s.days;
  // Today as the statistics count it: the logical day, which may have started yesterday.
  const todayKey = dayKey(logicalDayOf(Date.now(), cal));
  // Labels for at most ~16 columns, so they never overlap.
  const every = Math.max(1, Math.ceil(days.length / 16));
  const bySite = mode === 'sites' && s.stack.length > 0;
  const columns: Column[] = days.map((d, i) => ({
    key: d.day,
    label: i % every === 0 ? dayLabel(d.day, days.length) : '',
    name: d.day,
    seconds: d.seconds,
    parts: bySite ? [...d.sites, d.otherSites] : undefined,
    current: d.day === todayKey,
  }));
  return (
    <div class="card stack">
      <div class="card-head">
        <h2>{months ? t('insights.trend.months') : t('insights.trend')}</h2>
        <Segmented
          value={bySite ? 'sites' : 'total'}
          onChange={onMode}
          label={t('insights.mode')}
          options={[
            { value: 'total', label: t('insights.mode.total') },
            { value: 'sites', label: t('insights.mode.sites'), disabled: !s.stack.length },
          ]}
        />
      </div>
      <Columns
        columns={columns}
        head={months ? t('insights.month') : t('insights.day')}
        label={
          months
            ? t(bySite ? 'insights.trendSitesLabel.months' : 'insights.trendLabel.months')
            : t(bySite ? 'insights.trendSitesLabel' : 'insights.trendLabel')
        }
        series={bySite ? [...s.stack, t('insights.otherSites')] : undefined}
      />
    </div>
  );
}

/** The hours of one day, from the hour the day starts. */
function Hours({ s, cal }: { s: StatsModel; cal: { dayStart: number; weekStart: number } }) {
  const d = parseDayKey(s.from);
  const first = Math.floor(cal.dayStart / 60);
  const now = new Date();
  const isToday = s.from === dayKey(logicalDayOf(now.getTime(), cal));
  const columns: Column[] = [];
  for (let i = 0; i < 24; i++) {
    const hour = (first + i) % 24;
    // Hours before the one the day starts at belong to the next calendar day.
    const at = new Date(d.y, d.m, d.d + (hour < first ? 1 : 0), hour).getTime();
    columns.push({
      key: String(hour),
      label: i % 3 === 0 ? formatHour(at) : '',
      minor: i % 6 !== 0,
      name: `${formatTime(at)}–${formatTime(at + HOUR)}`,
      seconds: s.hours?.[hour] ?? 0,
      current: isToday && now.getHours() === hour,
    });
  }
  return (
    <div class="card stack">
      <h2>{t('insights.hours')}</h2>
      {s.hours ? (
        <Columns columns={columns} head={t('insights.hour')} label={t('insights.hoursLabel')} spread />
      ) : (
        <p class="muted small">{t('insights.noHours')}</p>
      )}
    </div>
  );
}

function monthly(s: StatsModel): StatsDay[] {
  const by = new Map<string, StatsDay>();
  for (const d of s.days) {
    const k = d.day.slice(0, 7);
    const cur = by.get(k) ?? {
      day: k,
      seconds: 0,
      visits: 0,
      sites: d.sites.map(() => 0),
      otherSites: 0,
    };
    cur.seconds += d.seconds;
    cur.visits += d.visits;
    d.sites.forEach((sec, i) => {
      cur.sites[i] += sec;
    });
    cur.otherSites += d.otherSites;
    by.set(k, cur);
  }
  return [...by.values()];
}

function DeleteDialog({
  onClose,
  sites,
  range,
}: {
  onClose: () => void;
  sites: string[];
  range: { from: string; to: string };
}) {
  const [scope, setScope] = useState<'range' | 'site' | 'all'>('range');
  const [host, setHost] = useState(sites[0] ?? '');
  const run = async () => {
    await call('stats.delete', { scope, from: range.from, to: range.to, host });
    toast(t('insights.deleted'));
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('insights.deleteTitle')}
      actions={
        <>
          <Button variant="primary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={run}>
            {t('insights.delete')}
          </Button>
        </>
      }
    >
      <div class="stack">
        <Segmented
          value={scope}
          onChange={setScope}
          label={t('insights.deleteWhat')}
          options={[
            { value: 'range', label: t('insights.delete.range') },
            { value: 'site', label: t('insights.delete.site'), disabled: !sites.length },
            { value: 'all', label: t('insights.delete.all') },
          ]}
        />
        {scope === 'site' && (
          <select
            class="select"
            value={host}
            aria-label={t('insights.delete.site')}
            onChange={(e) => setHost((e.target as HTMLSelectElement).value)}
          >
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <p class="small muted">{t('insights.deleteNote', { days: BUDGET_KEEP_DAYS })}</p>
      </div>
    </Dialog>
  );
}

export function InsightsPage() {
  const { model } = useDashboard();
  const groupName = (id: string) => model.config.groups.find((g) => g.id === id)?.name;
  const cal = { dayStart: model.config.settings.dayStart, weekStart: model.config.settings.weekStart };
  const [span, setSpan] = useState<Span>('week');
  const [offset, setOffset] = useState(0);
  const [del, setDel] = useState(false);
  const [trendMode, setTrendMode] = useState<TrendMode>('total');
  const range = rangeFor(span, offset, cal);
  const { data: s, reload } = useModel('stats.get', range, [range.from, range.to]);
  const exportAs = async (format: 'csv' | 'json') => {
    const r = await call('stats.export', { format });
    downloadText(r.filename, r.text, r.mime);
  };
  const change =
    s && s.previous.seconds > 0 ? (s.total.seconds - s.previous.seconds) / s.previous.seconds : null;
  const maxGroup = Math.max(1, ...(s?.groups.map((g) => g.seconds) ?? [1]));
  const maxSite = Math.max(1, ...(s?.sites.map((g) => g.seconds) ?? [1]));
  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <h1>{t('insights.title')}</h1>
          <p>{t('insights.subtitle')}</p>
        </div>
        <Menu
          label={t('insights.dataActions')}
          text={t('insights.data')}
          icon="download"
          items={[
            { label: t('insights.exportCsv'), icon: 'download', onSelect: () => void exportAs('csv') },
            { label: t('insights.exportJson'), icon: 'download', onSelect: () => void exportAs('json') },
            'separator',
            { label: t('insights.delete'), icon: 'trash', danger: true, onSelect: () => setDel(true) },
          ]}
        />
      </div>
      <div class="row between">
        <Segmented
          value={span}
          onChange={(v) => {
            setSpan(v);
            setOffset(0);
          }}
          label={t('insights.period')}
          options={(['day', 'week', 'month', 'year'] as Span[]).map((x) => ({
            value: x,
            label: t(`insights.span.${x}`),
          }))}
        />
        <div class="row nowrap">
          <IconButton
            icon="chevron-left"
            size="small"
            label={t('insights.previous')}
            onClick={() => setOffset(offset - 1)}
          />
          <strong class="num">{rangeLabel(span, range)}</strong>
          <IconButton
            icon="chevron-right"
            size="small"
            label={t('insights.next')}
            disabled={offset >= 0}
            onClick={() => setOffset(offset + 1)}
          />
        </div>
      </div>
      {!s ? (
        <Spinner />
      ) : (
        <>
          <div class="card">
            <div class="kpis">
              <div class="kpi">
                <span class="value">{formatDuration(s.total.seconds)}</span>
                <span class="caption">{t('insights.total')}</span>
                {change !== null && (
                  <span class="delta">{t('insights.vsPrevious', { change: formatPercent(change) })}</span>
                )}
              </div>
              {[
                { v: s.counters.impulses, c: t('insights.impulses', { count: s.counters.impulses }) },
                { v: s.counters.shown, c: t('insights.shown', { count: s.counters.shown }) },
                {
                  v: s.counters.pauses,
                  c: t('insights.pauses', { count: s.counters.pauses, minutes: s.counters.pauseMinutes }),
                },
                { v: s.counters.sessions, c: t('insights.sessions', { count: s.counters.sessions }) },
              ].map((k) => (
                <div class="kpi" key={k.c}>
                  <span class={`value${k.v ? '' : ' zero'}`}>{k.v}</span>
                  <span class="caption">{k.c}</span>
                </div>
              ))}
            </div>
          </div>
          {s.total.seconds === 0 && s.counters.shown === 0 ? (
            <div class="card">
              <Empty icon="chart" title={t('insights.empty')} />
            </div>
          ) : (
            <>
              {span === 'day' ? (
                <Hours s={s} cal={cal} />
              ) : (
                <Trend s={s} span={span} cal={cal} mode={trendMode} onMode={setTrendMode} />
              )}
              <div class="grid" style={{ ['--min' as string]: '320px' }}>
                <div class="card stack">
                  <h2>{t('insights.byGroup')}</h2>
                  {s.groups.length === 0 ? (
                    <p class="muted small">{t('insights.none')}</p>
                  ) : (
                    <table class="table">
                      <tbody>
                        {s.groups.map((g) => (
                          <tr key={g.id}>
                            <td>
                              <span class="row nowrap">
                                <ColorDot color={g.color} />
                                {g.name || t('insights.deletedGroup')}
                              </span>
                              <div
                                class="hbar"
                                style={{
                                  width: `${(g.seconds / maxGroup) * 100}%`,
                                  background: g.color,
                                  marginTop: '4px',
                                }}
                              />
                            </td>
                            <td class="num">{formatDuration(g.seconds)}</td>
                            <td class="num small muted">{t('insights.visits', { count: g.visits })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div class="card stack">
                  <h2>{t('insights.bySite')}</h2>
                  {s.sites.length === 0 ? (
                    <p class="muted small">{t('insights.none')}</p>
                  ) : (
                    <table class="table">
                      <tbody>
                        {s.sites.slice(0, 15).map((x) => (
                          <tr key={x.host}>
                            <td>
                              {x.host}
                              <div
                                class="hbar"
                                style={{ width: `${(x.seconds / maxSite) * 100}%`, marginTop: '4px' }}
                              />
                            </td>
                            <td class="num">{formatDuration(x.seconds)}</td>
                            <td class="num small muted">{t('insights.visits', { count: x.visits })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              <div class="grid" style={{ ['--min' as string]: '320px' }}>
                <div class="card stack">
                  <h2>{t('insights.pausesLog')}</h2>
                  {s.pauses.length === 0 ? (
                    <p class="muted small">{t('insights.noPauses')}</p>
                  ) : (
                    <ul class="list compact small">
                      {s.pauses.slice(0, 30).map((p, i) => (
                        <li key={i}>
                          <strong>{formatDateTime(p.at)}</strong> · {breakSubject(p, groupName)} ·{' '}
                          {t('common.minutes', { n: p.used ?? p.minutes })}
                          {p.reason && <> · “{p.reason}”</>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div class="card stack">
                  <h2>{t('insights.intentions')}</h2>
                  {s.intentions.length === 0 ? (
                    <p class="muted small">{t('insights.noIntentions')}</p>
                  ) : (
                    <ul class="list compact small">
                      {s.intentions.slice(0, 30).map((x, i) => (
                        <li key={i}>
                          <strong>{formatDateTime(x.at)}</strong> · “{x.text}” ·{' '}
                          {t('common.minutes', { n: x.minutes })}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
      <p class="help">{t('insights.privacy')}</p>
      {del && (
        <DeleteDialog
          onClose={() => {
            setDel(false);
            void reload();
          }}
          sites={s?.sites.map((x) => x.host) ?? []}
          range={range}
        />
      )}
    </div>
  );
}
