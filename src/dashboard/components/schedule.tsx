/**
 * Schedule editor (SCH-01…SCH-03): presets, precise time fields per window (accessible) and a
 * visual week grid where windows can be painted with mouse or touch. Columns are logical days
 * (they start at the configured day start, SEM-09), so overnight windows look continuous.
 */

import { Fragment } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { SCHEDULE_PRESETS } from '../../engine/defaults';
import { isFullDay } from '../../engine/time';
import type { Schedule, ScheduleMode, TimeWindow } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { formatMinutesOfDay, weekdayNames } from '../../shared/format';
import { describeWindows } from '../../shared/summary';
import { Button, Chips, IconButton } from '../../ui/components';
import { useDashboard } from '../context';

const SLOT = 30;
const SLOTS = 1440 / SLOT;

function toTimeInput(min: number) {
  const m = min >= 1440 ? 0 : min;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function fromTimeInput(v: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 7 × 48 bitmap of logical days. */
export function windowsToGrid(windows: TimeWindow[], dayStart: number): boolean[][] {
  const grid = Array.from({ length: 7 }, () => Array<boolean>(SLOTS).fill(false));
  for (const w of windows) {
    const full = isFullDay(w);
    const offset = full ? 0 : (w.start - dayStart + 1440) % 1440;
    let len = full ? 1440 : (w.end % 1440) - w.start;
    if (!full && len <= 0) len += 1440;
    const first = Math.floor(offset / SLOT);
    const last = Math.ceil((offset + len) / SLOT);
    for (const d of w.days) {
      for (let s = first; s < last; s++) {
        const day = (d + Math.floor(s / SLOTS)) % 7;
        grid[day][s % SLOTS] = true;
      }
    }
  }
  return grid;
}

export function gridToWindows(grid: boolean[][], dayStart: number): TimeWindow[] {
  const runs: { day: number; start: number; end: number }[] = [];
  grid.forEach((col, day) => {
    let s = -1;
    for (let i = 0; i <= SLOTS; i++) {
      const on = i < SLOTS && col[i];
      if (on && s === -1) s = i;
      if (!on && s !== -1) {
        runs.push({ day, start: s, end: i });
        s = -1;
      }
    }
  });
  const byRange = new Map<string, TimeWindow>();
  for (const r of runs) {
    const full = r.start === 0 && r.end === SLOTS;
    const start = full ? 0 : (dayStart + r.start * SLOT) % 1440;
    const endRaw = (dayStart + r.end * SLOT) % 1440;
    const end = full ? 1440 : endRaw === 0 ? 1440 : endRaw;
    const k = `${start}-${end}`;
    const w = byRange.get(k);
    if (w) w.days.push(r.day);
    else byRange.set(k, { days: [r.day], start, end });
  }
  return [...byRange.values()];
}

function WeekGrid({ windows, onChange }: { windows: TimeWindow[]; onChange: (w: TimeWindow[]) => void }) {
  const { model } = useDashboard();
  const { dayStart, weekStart } = model.config.settings;
  const grid = windowsToGrid(windows, dayStart);
  const [paint, setPaint] = useState<{ value: boolean; from: [number, number]; to: [number, number] } | null>(
    null,
  );
  const ref = useRef<HTMLDivElement>(null);
  const order = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  const names = weekdayNames('short');

  const cellAt = (x: number, y: number): [number, number] | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const d = el?.dataset?.day;
    const s = el?.dataset?.slot;
    return d !== undefined && s !== undefined ? [Number(d), Number(s)] : null;
  };
  const inRect = (day: number, slot: number) => {
    if (!paint) return false;
    const cols = [order.indexOf(paint.from[0]), order.indexOf(paint.to[0])].sort((a, b) => a - b);
    const rows = [paint.from[1], paint.to[1]].sort((a, b) => a - b);
    const c = order.indexOf(day);
    return c >= cols[0] && c <= cols[1] && slot >= rows[0] && slot <= rows[1];
  };
  const commit = () => {
    if (!paint) return;
    const next = grid.map((col) => [...col]);
    for (let d = 0; d < 7; d++) for (let s = 0; s < SLOTS; s++) if (inRect(d, s)) next[d][s] = paint.value;
    setPaint(null);
    onChange(gridToWindows(next, dayStart));
  };

  return (
    <div
      class="week-grid"
      ref={ref}
      aria-hidden="true"
      onPointerUp={commit}
      onPointerLeave={() => paint && commit()}
      onPointerMove={(e) => {
        if (!paint) return;
        const c = cellAt(e.clientX, e.clientY);
        if (c) setPaint({ ...paint, to: c });
      }}
    >
      <span />
      {order.map((d) => (
        <span key={d} class="day-head">
          {names[d]}
        </span>
      ))}
      {Array.from({ length: SLOTS }, (_, s) => (
        <Fragment key={`r${s}`}>
          <span class="hour">{s % 4 === 0 ? formatMinutesOfDay((dayStart + s * SLOT) % 1440) : ''}</span>
          {order.map((d) => {
            const on = grid[d][s];
            const prev = inRect(d, s);
            const cls = [
              'cell',
              s % 2 === 0 ? 'hour-start' : '',
              prev ? (paint!.value ? 'preview-on' : 'preview-off') : on ? 'on' : '',
            ].join(' ');
            return (
              <span
                key={`${d}-${s}`}
                class={cls}
                data-day={d}
                data-slot={s}
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                  setPaint({ value: !on, from: [d, s], to: [d, s] });
                }}
              />
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

function DayToggles({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  const { model } = useDashboard();
  const order = Array.from({ length: 7 }, (_, i) => (model.config.settings.weekStart + i) % 7);
  const names = weekdayNames('short');
  const long = weekdayNames('long');
  return (
    <div class="chips" role="group" aria-label={t('schedule.days')}>
      {order.map((d) => (
        <button
          key={d}
          type="button"
          class="chip"
          aria-pressed={days.includes(d)}
          aria-label={long[d]}
          onClick={() => onChange(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())}
        >
          {names[d]}
        </button>
      ))}
    </div>
  );
}

export function WindowsEditor({
  windows,
  onChange,
}: {
  windows: TimeWindow[];
  onChange: (w: TimeWindow[]) => void;
}) {
  const [grid, setGrid] = useState(false);
  const set = (i: number, w: TimeWindow) => onChange(windows.map((x, j) => (j === i ? w : x)));
  return (
    <div class="stack">
      <div class="row">
        <span class="small muted">{t('schedule.presets')}:</span>
        {Object.keys(SCHEDULE_PRESETS).map((k) => (
          <button
            key={k}
            type="button"
            class="chip"
            onClick={() => onChange(JSON.parse(JSON.stringify(SCHEDULE_PRESETS[k])))}
          >
            {t(`schedule.preset.${k}`)}
          </button>
        ))}
      </div>
      {windows.map((w, i) => (
        <div key={i} class="card flat tight stack stack-sm">
          <div class="row between">
            <DayToggles days={w.days} onChange={(days) => set(i, { ...w, days })} />
            <IconButton
              icon="trash"
              size="small"
              variant="ghost"
              label={t('schedule.removeWindow')}
              onClick={() => onChange(windows.filter((_, j) => j !== i))}
            />
          </div>
          <div class="row">
            <label class="row nowrap small">
              {t('schedule.from')}
              <input
                type="time"
                class="input inline"
                value={toTimeInput(w.start)}
                disabled={isFullDay(w)}
                onChange={(e) => {
                  const v = fromTimeInput((e.target as HTMLInputElement).value);
                  if (v !== null) set(i, { ...w, start: v, end: isFullDay(w) ? 1440 : w.end });
                }}
              />
            </label>
            <label class="row nowrap small">
              {t('schedule.to')}
              <input
                type="time"
                class="input inline"
                value={toTimeInput(w.end)}
                disabled={isFullDay(w)}
                onChange={(e) => {
                  const v = fromTimeInput((e.target as HTMLInputElement).value);
                  if (v !== null) set(i, { ...w, end: v === 0 ? 1440 : v });
                }}
              />
            </label>
            <label class="check small">
              <input
                type="checkbox"
                checked={isFullDay(w)}
                onChange={(e) =>
                  set(
                    i,
                    (e.target as HTMLInputElement).checked
                      ? { ...w, start: 0, end: 1440 }
                      : { ...w, start: 9 * 60, end: 17 * 60 },
                  )
                }
              />
              {t('time.allDay')}
            </label>
          </div>
          {!isFullDay(w) && w.end % 1440 <= w.start && w.end % 1440 !== 0 && (
            <span class="help">{t('schedule.overnight')}</span>
          )}
        </div>
      ))}
      <div class="row">
        <Button
          size="small"
          icon="plus"
          onClick={() => onChange([...windows, { days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 }])}
        >
          {t('schedule.addWindow')}
        </Button>
        <Button
          size="small"
          variant="ghost"
          icon="calendar"
          aria-expanded={grid}
          onClick={() => setGrid(!grid)}
        >
          {grid ? t('schedule.hideGrid') : t('schedule.showGrid')}
        </Button>
      </div>
      {grid && (
        <div class="stack stack-sm">
          <p class="help">{t('schedule.gridHelp')}</p>
          <WeekGrid windows={windows} onChange={onChange} />
        </div>
      )}
      {windows.length > 0 && <p class="small text-2">{describeWindows(windows)}</p>}
    </div>
  );
}

export function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: Schedule;
  onChange: (s: Schedule) => void;
}) {
  return (
    <div class="stack">
      <Chips<ScheduleMode>
        value={schedule.mode}
        onChange={(mode) =>
          onChange({
            mode,
            windows:
              mode !== 'always' && !schedule.windows.length
                ? JSON.parse(JSON.stringify(SCHEDULE_PRESETS.office))
                : schedule.windows,
          })
        }
        label={t('schedule.when')}
        options={[
          { value: 'always', label: t('schedule.mode.always') },
          { value: 'during', label: t('schedule.mode.during') },
          { value: 'outside', label: t('schedule.mode.outside') },
        ]}
      />
      {schedule.mode !== 'always' && (
        <WindowsEditor
          windows={schedule.windows}
          onChange={(windows) => onChange({ ...schedule, windows })}
        />
      )}
    </div>
  );
}
