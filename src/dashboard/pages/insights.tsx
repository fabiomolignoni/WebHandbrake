/**
 * Insights (STA-02…STA-06): day, week, month, year; per group and per site; trend and comparison
 * with the previous period; attempts and pauses; neutral language (STA-04, ETH-04).
 * Charts always have text labels and a table alternative (A11Y-04).
 */

import { useState } from 'preact/hooks';
import { addDays, dayKey, logicalDayOf, parseDayKey, weekdayOf } from '../../engine/time';
import { t } from '../../i18n/i18n';
import { formatDate, formatDateTime, formatDuration, formatPercent } from '../../shared/format';
import type { StatsModel } from '../../shared/models';
import { call } from '../../shared/rpc';
import { Button, Chips, ColorDot, Dialog, Empty, IconButton, Spinner, toast } from '../../ui/components';
import { downloadText } from '../../ui/download';
import { useModel } from '../../ui/hooks';
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

function Trend({ s }: { s: StatsModel }) {
  const [table, setTable] = useState(false);
  const days = s.days.length > 62 ? monthly(s) : s.days;
  const max = Math.max(1, ...days.map((d) => d.seconds));
  const todayKey = dayKey(logicalDayOf(Date.now(), { dayStart: 0, weekStart: 1 }));
  return (
    <div class="stack stack-sm">
      {!table ? (
        <div class="bars" role="img" aria-label={t('insights.trendLabel')}>
          {days.map((d) => (
            <div
              key={d.day}
              class={`bar${d.seconds ? '' : ' empty-bar'}${d.day === todayKey ? ' today' : ''}`}
              style={{ height: `${Math.max(2, (d.seconds / max) * 100)}%` }}
              title={`${d.day}: ${formatDuration(d.seconds)}`}
            />
          ))}
        </div>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>{t('insights.day')}</th>
              <th class="num">{t('insights.time')}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td class="num">{formatDuration(d.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

function monthly(s: StatsModel) {
  const by = new Map<string, { day: string; seconds: number; visits: number }>();
  for (const d of s.days) {
    const k = d.day.slice(0, 7);
    const cur = by.get(k) ?? { day: k, seconds: 0, visits: 0 };
    cur.seconds += d.seconds;
    cur.visits += d.visits;
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
        <Chips
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
        <p class="small muted">{t('insights.deleteNote')}</p>
      </div>
    </Dialog>
  );
}

export function InsightsPage() {
  const { model } = useDashboard();
  const cal = { dayStart: model.config.settings.dayStart, weekStart: model.config.settings.weekStart };
  const [span, setSpan] = useState<Span>('week');
  const [offset, setOffset] = useState(0);
  const [del, setDel] = useState(false);
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
        <div class="row">
          <Button size="small" icon="download" onClick={() => exportAs('csv')}>
            CSV
          </Button>
          <Button size="small" icon="download" onClick={() => exportAs('json')}>
            JSON
          </Button>
          <Button size="small" variant="danger" icon="trash" onClick={() => setDel(true)}>
            {t('insights.delete')}
          </Button>
        </div>
      </div>
      <div class="row between">
        <Chips
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
          <div class="grid tiles" style={{ ['--min' as string]: '200px' }}>
            <div class="card tile">
              <span class="value">{formatDuration(s.total.seconds)}</span>
              <span class="caption">{t('insights.total')}</span>
              {change !== null && (
                <span class="small muted">{t('insights.vsPrevious', { change: formatPercent(change) })}</span>
              )}
            </div>
            <div class="card tile">
              <span class="value">{s.counters.impulses}</span>
              <span class="caption">{t('insights.impulses', { count: s.counters.impulses })}</span>
            </div>
            <div class="card tile">
              <span class="value">{s.counters.shown}</span>
              <span class="caption">{t('insights.shown', { count: s.counters.shown })}</span>
            </div>
            <div class="card tile">
              <span class="value">{s.counters.pauses}</span>
              <span class="caption">
                {t('insights.pauses', { count: s.counters.pauses, minutes: s.counters.pauseMinutes })}
              </span>
            </div>
            <div class="card tile">
              <span class="value">{s.counters.sessions}</span>
              <span class="caption">{t('insights.sessions', { count: s.counters.sessions })}</span>
            </div>
          </div>
          {s.total.seconds === 0 && s.counters.shown === 0 ? (
            <div class="card">
              <Empty icon="chart" title={t('insights.empty')} />
            </div>
          ) : (
            <>
              {span !== 'day' && (
                <div class="card stack">
                  <h2>{t('insights.trend')}</h2>
                  <Trend s={s} />
                </div>
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
                          <strong>{formatDateTime(p.at)}</strong> ·{' '}
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
