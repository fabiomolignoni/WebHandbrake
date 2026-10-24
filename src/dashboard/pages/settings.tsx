/** Settings. */

import { useState } from 'preact/hooks';
import { clone } from '../../engine/json';
import {
  BUDGET_KEEP_DAYS,
  DAILY_SNAPSHOTS,
  MINUTE_RETENTION_MINUTES,
  RECENT_SNAPSHOTS,
} from '../../engine/limits';
import type { Config, Settings } from '../../engine/types';
import { AVAILABLE_LOCALES, t } from '../../i18n/i18n';
import { api } from '../../platform/api';
import { formatDateTime, formatMinutesOfDay, weekdayNames } from '../../shared/format';
import { NEW_ISSUE_URL } from '../../shared/links';
import type { ImportPreview } from '../../shared/models';
import { call } from '../../shared/rpc';
import { describeUnit } from '../../shared/summary';
import {
  Banner,
  Button,
  Dialog,
  DurationInput,
  Field,
  Segmented,
  Select,
  Spinner,
  Toggle,
  toast,
} from '../../ui/components';
import { copyText, downloadText, pickTextFile } from '../../ui/download';
import { useModel } from '../../ui/hooks';
import { Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { BreakLimits } from '../components/pause-editor';
import { useDashboard } from '../context';
import { navigate } from '../router';

type Sub = 'general' | 'feedback' | 'time' | 'interventions' | 'data' | 'privacy' | 'diagnostics';
const SUBS: Sub[] = ['general', 'feedback', 'time', 'interventions', 'data', 'privacy', 'diagnostics'];

function useSettingsSave() {
  const { model } = useDashboard();
  const flow = useSaveFlow();
  const save = (mutate: (s: Settings, c: Config) => void) => {
    const next = clone(model.config);
    mutate(next.settings, next);
    return flow.run(call('config.save', { config: next }));
  };
  return { save, element: flow.element, s: model.config.settings };
}

function General() {
  const { save, element, s } = useSettingsSave();
  const weekdays = weekdayNames('long');
  return (
    <div class="stack stack-lg">
      <div class="card stack">
        <h2>{t(AVAILABLE_LOCALES.length > 1 ? 'settings.appearanceLanguage' : 'settings.appearance')}</h2>
        <Field label={t('settings.theme')}>
          {() => (
            <Segmented
              value={s.theme}
              onChange={(theme) => void save((x) => (x.theme = theme))}
              label={t('settings.theme')}
              options={[
                { value: 'system', label: t('settings.theme.system'), icon: 'settings' },
                { value: 'light', label: t('settings.theme.light'), icon: 'sun' },
                { value: 'dark', label: t('settings.theme.dark'), icon: 'moon' },
              ]}
            />
          )}
        </Field>
        <Toggle
          checked={s.highContrast}
          onChange={(v) => void save((x) => (x.highContrast = v))}
          label={t('settings.highContrast')}
        />
        {/* With one language there is nothing to choose. */}
        {AVAILABLE_LOCALES.length > 1 && (
          <Field label={t('settings.language')} help={t('settings.languageHelp')}>
            {(id, d) => (
              <Select
                id={id}
                describedBy={d}
                value={s.language}
                onChange={(language) =>
                  void save((x) => (x.language = language)).then(() => location.reload())
                }
                options={[
                  { value: 'auto', label: t('settings.language.auto') },
                  ...AVAILABLE_LOCALES.map((l) => ({ value: l.code, label: l.name })),
                ]}
              />
            )}
          </Field>
        )}
      </div>
      <div class="card stack">
        <h2>{t('settings.formats')}</h2>
        <Field label={t('settings.hour12')}>
          {(id) => (
            <Segmented
              labelledBy={`${id}-label`}
              value={s.hour12}
              onChange={(hour12) => void save((x) => (x.hour12 = hour12))}
              options={[
                { value: 'auto', label: t('settings.auto') },
                { value: '24', label: t('settings.hour12.24') },
                { value: '12', label: t('settings.hour12.12') },
              ]}
            />
          )}
        </Field>
        <Field label={t('settings.dateFormat')}>
          {(id) => (
            <Segmented
              labelledBy={`${id}-label`}
              value={s.dateFormat}
              onChange={(dateFormat) => void save((x) => (x.dateFormat = dateFormat))}
              options={[
                { value: 'auto', label: t('settings.auto') },
                { value: 'iso', label: 'YYYY-MM-DD' },
              ]}
            />
          )}
        </Field>
        <Field label={t('settings.weekStart')}>
          {(id) => (
            <Segmented
              labelledBy={`${id}-label`}
              value={s.weekStart}
              onChange={(weekStart) => void save((x) => (x.weekStart = weekStart))}
              options={[1, 6, 0].map((d) => ({ value: d, label: weekdays[d] }))}
            />
          )}
        </Field>
        <Field
          label={t('settings.dayStart')}
          help={t('settings.dayStartHelp', { time: formatMinutesOfDay(4 * 60) })}
        >
          {(id, d) => (
            <Select
              id={id}
              describedBy={d}
              value={String(s.dayStart)}
              onChange={(v) => void save((x) => (x.dayStart = Number(v)))}
              options={[0, 60, 120, 180, 240, 300, 360].map((m) => ({
                value: String(m),
                label: formatMinutesOfDay(m),
              }))}
            />
          )}
        </Field>
      </div>
      <div class="card stack">
        <h2>{t('settings.mode')}</h2>
        <Toggle
          checked={s.contextMenu}
          onChange={(v) => void save((x) => (x.contextMenu = v))}
          label={t('settings.contextMenu')}
          help={t('settings.contextMenuHelp')}
        />
        <p class="small muted">{t('settings.shortcuts')}</p>
      </div>
      {element}
    </div>
  );
}

function Feedback() {
  const { save, element, s } = useSettingsSave();
  const [perm, setPerm] = useState<boolean | null>(null);
  const enableNotifications = async (v: boolean) => {
    if (v) {
      const ok = await api.permissions.request({ permissions: ['notifications'] }).catch(() => false);
      setPerm(ok);
      if (!ok) return;
    }
    await save((x) => (x.notifications.enabled = v));
  };
  return (
    <div class="stack stack-lg">
      <div class="card stack">
        <h2>{t('settings.timer')}</h2>
        <Toggle
          checked={s.timer.enabled}
          onChange={(v) => void save((x) => (x.timer.enabled = v))}
          label={t('settings.timer.enabled')}
          help={t('settings.timer.help')}
        />
        <Field label={t('settings.timer.threshold')}>
          {(id) => (
            <DurationInput
              id={id}
              units={['minutes', 'hours']}
              commitOnBlur
              value={s.timer.thresholdMinutes}
              min={1}
              max={1440}
              label={t('settings.timer.threshold')}
              onChange={(v) => void save((x) => (x.timer.thresholdMinutes = v))}
            />
          )}
        </Field>
        <Field label={t('settings.timer.corner')}>
          {(id) => (
            // Two by two, where the corners are on the screen.
            <Segmented
              class="corners"
              labelledBy={`${id}-label`}
              value={s.timer.corner}
              onChange={(corner) => void save((x) => (x.timer.corner = corner))}
              options={(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((c) => ({
                value: c,
                label: t(`settings.corner.${c}`),
              }))}
            />
          )}
        </Field>
        <Field label={t('settings.timer.size')}>
          {(id) => (
            <Segmented
              labelledBy={`${id}-label`}
              value={s.timer.size}
              onChange={(size) => void save((x) => (x.timer.size = size))}
              options={(['small', 'medium', 'large'] as const).map((c) => ({
                value: c,
                label: t(`settings.size.${c}`),
              }))}
            />
          )}
        </Field>
        <Field label={t('settings.timer.opacity')}>
          {(id) => (
            <input
              id={id}
              type="range"
              min={0.4}
              max={1}
              step={0.05}
              value={s.timer.opacity}
              onChange={(e) =>
                void save((x) => (x.timer.opacity = Number((e.target as HTMLInputElement).value)))
              }
            />
          )}
        </Field>
      </div>
      <div class="card stack">
        <h2>{t('settings.badge')}</h2>
        <Toggle
          checked={s.badge.enabled}
          onChange={(v) => void save((x) => (x.badge.enabled = v))}
          label={t('settings.badge.enabled')}
        />
        <Field label={t('settings.badge.threshold')}>
          {(id) => (
            <DurationInput
              id={id}
              units={['minutes', 'hours']}
              commitOnBlur
              value={s.badge.thresholdMinutes}
              min={1}
              max={1440}
              label={t('settings.badge.threshold')}
              onChange={(v) => void save((x) => (x.badge.thresholdMinutes = v))}
            />
          )}
        </Field>
      </div>
      <div class="card stack">
        <h2>{t('settings.warnings')}</h2>
        <Field label={t('settings.warningSeconds')} help={t('settings.warningSecondsHelp')}>
          {(id, d) => (
            <DurationInput
              id={id}
              describedBy={d}
              base="seconds"
              units={['seconds', 'minutes']}
              commitOnBlur
              value={s.warningSeconds}
              min={0}
              max={3600}
              label={t('settings.warningSeconds')}
              onChange={(v) => void save((x) => (x.warningSeconds = v))}
            />
          )}
        </Field>
        <Toggle
          checked={s.notifications.enabled}
          onChange={(v) => void enableNotifications(v)}
          label={t('settings.notifications')}
          help={t('settings.notificationsHelp')}
        />
        {perm === false && <Banner kind="warning">{t('settings.notificationsDenied')}</Banner>}
        {s.notifications.enabled && (
          <div class="stack stack-sm" style={{ paddingInlineStart: '54px' }}>
            <label class="check small">
              <input
                type="checkbox"
                checked={s.notifications.sessionEnd}
                onChange={(e) =>
                  void save((x) => (x.notifications.sessionEnd = (e.target as HTMLInputElement).checked))
                }
              />
              {t('settings.notify.sessionEnd')}
            </label>
            <label class="check small">
              <input
                type="checkbox"
                checked={s.notifications.pendingReady}
                onChange={(e) =>
                  void save((x) => (x.notifications.pendingReady = (e.target as HTMLInputElement).checked))
                }
              />
              {t('settings.notify.pendingReady')}
            </label>
            <label class="check small">
              <input
                type="checkbox"
                checked={s.notifications.warning}
                onChange={(e) =>
                  void save((x) => (x.notifications.warning = (e.target as HTMLInputElement).checked))
                }
              />
              {t('settings.notify.warning')}
            </label>
          </div>
        )}
        <Toggle
          checked={s.sound}
          onChange={(v) => void save((x) => (x.sound = v))}
          label={t('settings.sound')}
          help={t('settings.soundHelp')}
        />
      </div>
      {element}
    </div>
  );
}

function TimeSettings() {
  const { save, element, s } = useSettingsSave();
  return (
    <div class="stack stack-lg">
      <div class="card stack">
        <h2>{t('settings.tracking')}</h2>
        <p class="help">{t('settings.trackingHelp')}</p>
        <Toggle
          checked={s.tracking.idleEnabled}
          onChange={(v) => void save((x) => (x.tracking.idleEnabled = v))}
          label={t('settings.idle')}
          help={t('settings.idleHelp')}
        />
        {s.tracking.idleEnabled && (
          <Field label={t('settings.idleSeconds')}>
            {(id) => (
              <DurationInput
                id={id}
                base="seconds"
                units={['seconds', 'minutes']}
                commitOnBlur
                value={s.tracking.idleSeconds}
                min={15}
                max={3600}
                label={t('settings.idleSeconds')}
                onChange={(v) => void save((x) => (x.tracking.idleSeconds = v))}
              />
            )}
          </Field>
        )}
        <Toggle
          checked={s.tracking.countAudio}
          onChange={(v) => void save((x) => (x.tracking.countAudio = v))}
          label={t('settings.countAudio')}
          help={t('settings.countAudioHelp')}
        />
        <Toggle
          checked={s.tracking.countInactive}
          onChange={(v) => void save((x) => (x.tracking.countInactive = v))}
          label={t('settings.countInactive')}
          help={t('settings.countInactiveHelp')}
        />
        <Field label={t('settings.visitGap')} help={t('settings.visitGapHelp')}>
          {(id, d) => (
            <DurationInput
              id={id}
              describedBy={d}
              units={['minutes', 'hours']}
              commitOnBlur
              value={s.tracking.visitGapMinutes}
              min={1}
              max={240}
              label={t('settings.visitGap')}
              onChange={(v) => void save((x) => (x.tracking.visitGapMinutes = v))}
            />
          )}
        </Field>
      </div>
      <div class="card stack">
        <h2>{t('settings.statistics')}</h2>
        <Toggle
          checked={s.tracking.allSites}
          onChange={(v) => void save((x) => (x.tracking.allSites = v))}
          label={t('settings.allSites')}
          help={t('settings.allSitesHelp')}
        />
        <Field label={t('settings.retention')} help={t('settings.retentionHelp')}>
          {(id, d) => (
            <DurationInput
              id={id}
              describedBy={d}
              base="days"
              units={['days']}
              commitOnBlur
              value={s.tracking.retentionDays}
              min={7}
              max={3650}
              label={t('settings.retention')}
              onChange={(v) => void save((x) => (x.tracking.retentionDays = v))}
            />
          )}
        </Field>
        <Toggle
          checked={s.clock.useDateHeaders}
          onChange={(v) => void save((x) => (x.clock.useDateHeaders = v))}
          label={t('settings.dateHeaders')}
          help={t('settings.dateHeadersHelp', { hours: s.protection.emergencyHours })}
        />
      </div>
      {element}
    </div>
  );
}

function InterventionSettings() {
  const { save, element, s } = useSettingsSave();
  const [css, setCss] = useState(s.interventions.customCss);
  return (
    <div class="stack stack-lg">
      <div class="card stack">
        <h2>{t('settings.pages')}</h2>
        <Toggle
          checked={s.interventions.hideUrl}
          onChange={(v) => void save((x) => (x.interventions.hideUrl = v))}
          label={t('settings.hideUrl')}
          help={t('settings.hideUrlHelp')}
        />
        <Toggle
          checked={s.interventions.autoReopen}
          onChange={(v) => void save((x) => (x.interventions.autoReopen = v))}
          label={t('settings.autoReopen')}
          help={t('settings.autoReopenHelp')}
        />
        <Field label={t('settings.grace')} help={t('settings.graceHelp')}>
          {(id, d) => (
            <DurationInput
              id={id}
              describedBy={d}
              base="seconds"
              units={['seconds', 'minutes']}
              commitOnBlur
              value={s.interventions.graceSeconds}
              min={0}
              max={300}
              label={t('settings.grace')}
              onChange={(v) => void save((x) => (x.interventions.graceSeconds = v))}
            />
          )}
        </Field>
      </div>
      <div class="card stack">
        <h2>{t('settings.globalBreaks')}</h2>
        <p class="help">{t('settings.globalBreaksHelp')}</p>
        <BreakLimits
          commitOnBlur
          value={s.pauseLimit}
          defaults={{ count: 5, minutes: 60 }}
          onChange={(limit) => void save((x) => (x.pauseLimit = limit))}
        />
      </div>
      <div class="card stack">
        <h2>{t('settings.customCss')}</h2>
        <p class="help">{t('settings.customCssHelp')}</p>
        <textarea
          class="textarea mono"
          rows={6}
          value={css}
          aria-label={t('settings.customCss')}
          onInput={(e) => setCss((e.target as HTMLTextAreaElement).value)}
        />
        <div class="row">
          <Button
            size="small"
            variant="primary"
            disabled={css === s.interventions.customCss}
            onClick={() => void save((x) => (x.interventions.customCss = css))}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
      {element}
    </div>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { model } = useDashboard();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const flow = useSaveFlow();
  const doPreview = async (txt = text) => setPreview(await call('data.preview', { text: txt, mode }));
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={t('import.title')}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={
              !preview || preview.format === 'unknown' || (preview.errors.length > 0 && !preview.units.length)
            }
            onClick={async () => {
              const ok = await flow.run(call('data.import', { text, mode }));
              if (ok) onClose();
            }}
          >
            {t('import.apply')}
          </Button>
        </>
      }
    >
      <div class="stack">
        <p class="help">{t('import.help', { hours: model.config.settings.protection.emergencyHours })}</p>
        <div class="row">
          <Button
            icon="upload"
            onClick={async () => {
              const txt = await pickTextFile();
              if (txt === null) return;
              setText(txt);
              await doPreview(txt);
            }}
          >
            {t('import.chooseFile')}
          </Button>
          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m);
              setPreview(null);
            }}
            label={t('import.mode')}
            options={[
              { value: 'merge', label: t('import.merge') },
              { value: 'replace', label: t('import.replace') },
            ]}
          />
        </div>
        <textarea
          class="textarea mono"
          rows={6}
          value={text}
          placeholder={t('import.paste')}
          aria-label={t('import.paste')}
          onInput={(e) => {
            setText((e.target as HTMLTextAreaElement).value);
            setPreview(null);
          }}
        />
        <div class="row">
          <Button size="small" onClick={() => doPreview()} disabled={!text.trim()}>
            {t('import.preview')}
          </Button>
        </div>
        {preview && (
          <div class="stack stack-sm">
            <p>
              <strong>{t('import.format', { format: t(`import.format.${preview.format}`) })}</strong>
            </p>
            {preview.groups.length > 0 && (
              <ul class="list compact small">
                {preview.groups.map((g, i) => (
                  <li key={i}>{t('import.groupLine', { name: g.name, sites: g.sites })}</li>
                ))}
              </ul>
            )}
            {preview.errors.map((e, i) => (
              <Banner key={i} kind="danger">
                {e}
              </Banner>
            ))}
            {preview.warnings.length > 0 && (
              <Banner kind="warning">
                <strong>{t('import.report')}</strong>
                <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
                  {preview.warnings.slice(0, 30).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Banner>
            )}
            {preview.units.length > 0 && (
              <details class="disclosure">
                <summary>
                  {t('import.changes', {
                    count: preview.units.length,
                    weakening: preview.directions.filter((d) => d === 'weaken').length,
                  })}
                </summary>
                <ul class="body small" style={{ paddingInlineStart: '32px' }}>
                  {preview.units.slice(0, 100).map((u, i) => (
                    <li key={i}>
                      {describeUnit(u)}{' '}
                      {preview.directions[i] === 'weaken' && (
                        <span class="tag warning">{t('import.weakening')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
      {flow.element}
    </Dialog>
  );
}

/** The reason of a backup; reasons this version does not know (older imports…) get a generic label. */
function backupReason(reason: string): string {
  const key = `backup.reason.${reason}`;
  const label = t(key);
  if (label !== key) return label;
  return reason.startsWith('import-') ? t('backup.reason.import') : t('backup.reason.other');
}

function DataSettings() {
  const { model } = useDashboard();
  const hours = model.config.settings.protection.emergencyHours;
  const [stats, setStats] = useState(false);
  const [secrets, setSecrets] = useState(false);
  const [importing, setImporting] = useState(false);
  const { data: backups } = useModel('backups.list', {});
  const flow = useSaveFlow();
  return (
    <div class="stack stack-lg">
      <div class="card stack">
        <h2>{t('data.export')}</h2>
        <p class="help">{t('data.exportHelp')}</p>
        <label class="check">
          <input
            type="checkbox"
            checked={stats}
            onChange={(e) => setStats((e.target as HTMLInputElement).checked)}
          />
          {t('data.includeStats')}
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={secrets}
            onChange={(e) => setSecrets((e.target as HTMLInputElement).checked)}
          />
          {t('data.includeSecrets')}
        </label>
        <div class="row">
          <Button
            variant="primary"
            icon="download"
            onClick={async () => {
              const r = await call('data.export', { stats, secrets });
              downloadText(r.filename, r.text);
            }}
          >
            {t('data.download')}
          </Button>
          <Button
            icon="copy"
            onClick={async () => {
              const r = await call('data.export', { stats, secrets });
              toast((await copyText(r.text)) ? t('data.copied') : t('data.copyFailed'));
            }}
          >
            {t('data.copy')}
          </Button>
        </div>
      </div>
      <div class="card stack">
        <h2>{t('data.import')}</h2>
        <p class="help">{t('data.importHelp')}</p>
        <div class="row">
          <Button icon="upload" onClick={() => setImporting(true)}>
            {t('data.importAction')}
          </Button>
        </div>
      </div>
      <div class="card stack">
        <h2>{t('data.backups')}</h2>
        <p class="help">{t('data.backupsHelp', { hours })}</p>
        {!backups ? (
          <Spinner />
        ) : backups.length === 0 ? (
          <p class="muted">{t('data.noBackups')}</p>
        ) : (
          <ul class="list compact">
            {backups.slice(0, 50).map((b) => (
              <li key={b.at} class="row between">
                <span class="small">
                  {formatDateTime(b.at)} · {backupReason(b.reason)} ·{' '}
                  {t('data.groupsCount', { count: b.groups })}
                </span>
                <Button size="small" onClick={() => void flow.run(call('backups.restore', { at: b.at }))}>
                  {t('data.restore')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div class="card stack">
        <h2>{t('data.reset')}</h2>
        <p class="help">{t('data.resetHelp')}</p>
        <div class="row">
          <Button
            variant="danger"
            icon="refresh"
            onClick={() =>
              confirm(t('data.resetConfirm', { hours })) && void flow.run(call('data.reset', {}))
            }
          >
            {t('data.resetAction')}
          </Button>
        </div>
      </div>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {flow.element}
    </div>
  );
}

function Privacy() {
  const { data } = useModel('data.usage', {});
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div class="stack stack-lg">
      <div class="card stack">
        <h2>{t('privacy.title')}</h2>
        <p>{t('privacy.summary')}</p>
        <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
          <li>{t('privacy.point.local')}</li>
          <li>{t('privacy.point.noNetwork')}</li>
          <li>{t('privacy.point.aggregates')}</li>
          <li>{t('privacy.point.private')}</li>
          <li>{t('privacy.point.content')}</li>
        </ul>
      </div>
      <div class="card stack">
        <h2>{t('privacy.stored')}</h2>
        {!data ? (
          <Spinner />
        ) : (
          <table class="table">
            <tbody>
              {data.keys
                .sort((a, b) => b.bytes - a.bytes)
                .map((k) => (
                  <tr key={k.name}>
                    <td>
                      {t(`privacy.key.${k.name}`) === `privacy.key.${k.name}`
                        ? k.name
                        : t(`privacy.key.${k.name}`)}
                    </td>
                    <td class="num">{Math.ceil(k.bytes / 1024)} KB</td>
                  </tr>
                ))}
              <tr>
                <th>{t('privacy.total')}</th>
                <th class="num">{data.total !== null ? `${Math.ceil(data.total / 1024)} KB` : '—'}</th>
              </tr>
            </tbody>
          </table>
        )}
        <p class="small muted">
          {t('privacy.retention', {
            hours: MINUTE_RETENTION_MINUTES / 60,
            recent: RECENT_SNAPSHOTS,
            daily: DAILY_SNAPSHOTS,
          })}
        </p>
      </div>
      <div class="card stack">
        <h2>{t('privacy.network')}</h2>
        <p>{t('privacy.networkBody')}</p>
      </div>
      <div class="card stack">
        <h2>{t('privacy.deleteAll')}</h2>
        <p class="help">{t('privacy.deleteAllHelp', { days: BUDGET_KEEP_DAYS })}</p>
        <div class="row">
          <Button variant="danger" icon="trash" onClick={() => setConfirmDel(true)}>
            {t('privacy.deleteStats')}
          </Button>
          <Button variant="ghost" onClick={() => navigate('/settings/data')}>
            {t('privacy.resetLink')}
          </Button>
        </div>
      </div>
      {confirmDel && (
        <Dialog
          open
          onClose={() => setConfirmDel(false)}
          title={t('privacy.deleteStats')}
          actions={
            <>
              <Button variant="primary" onClick={() => setConfirmDel(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  setConfirmDel(false);
                  await call('stats.delete', { scope: 'all' });
                  toast(t('insights.deleted'));
                }}
              >
                {t('privacy.deleteStats')}
              </Button>
            </>
          }
        >
          <p>{t('privacy.deleteStatsBody', { days: BUDGET_KEEP_DAYS })}</p>
        </Dialog>
      )}
    </div>
  );
}

function Diagnostics() {
  const { data: d, reload } = useModel('diag.get', {}, [], 5000);
  const { save, element, s } = useSettingsSave();
  const [urls, setUrls] = useState(false);
  if (!d) return <Spinner />;
  return (
    <div class="stack stack-lg">
      <div class="card stack">
        <h2>{t('diag.rules')}</h2>
        <table class="table">
          <tbody>
            <tr>
              <td>{t('diag.dynamic')}</td>
              <td class="num">
                {d.rules.dynamic} / {d.rules.limits.total}
              </td>
            </tr>
            <tr>
              <td>{t('diag.regex')}</td>
              <td class="num">
                {d.rules.regex} / {d.rules.limits.regex}
              </td>
            </tr>
            <tr>
              <td>{t('diag.redirects')}</td>
              <td class="num">
                {d.rules.redirects} / {d.rules.limits.unsafe}
              </td>
            </tr>
            <tr>
              <td>{t('diag.compileMs')}</td>
              <td class="num">{d.rules.lastCompileMs} ms</td>
            </tr>
          </tbody>
        </table>
        {d.rules.lastError && (
          <Banner kind="danger">{t('diag.lastError', { error: d.rules.lastError })}</Banner>
        )}
        {d.rules.overflow.length > 0 && (
          <Banner kind="warning">{t('diag.overflow', { count: d.rules.overflow.length })}</Banner>
        )}
        {d.invalidTargets.length > 0 && (
          <Banner kind="warning">{t('diag.invalidTargets', { list: d.invalidTargets.join(', ') })}</Banner>
        )}
      </div>
      <div class="card stack">
        <h2>{t('diag.permissions')}</h2>
        <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
          <li>{t('diag.perm.host', { ok: d.permissions.hostAccess ? t('common.yes') : t('common.no') })}</li>
          <li>
            {t('diag.perm.incognito', { ok: d.permissions.incognito ? t('common.yes') : t('common.no') })}
          </li>
          <li>
            {t('diag.perm.notifications', {
              ok: d.permissions.notifications ? t('common.yes') : t('common.no'),
            })}
          </li>
        </ul>
        <p class="small muted">
          {d.browser} · WebHandbrake {d.version} ·{' '}
          {d.storageBytes !== null ? `${Math.ceil(d.storageBytes / 1024)} KB` : ''}
        </p>
      </div>
      <div class="card stack">
        <h2>{t('diag.selftest')}</h2>
        <p class="help">{t('diag.selftestHelp')}</p>
        <div class="row">
          <Button
            icon="flask"
            onClick={async () => {
              await call('diag.selftest', {});
              setTimeout(() => void reload(), 3000);
            }}
          >
            {t('diag.runSelftest')}
          </Button>
        </div>
      </div>
      <div class="card stack">
        <div class="card-head">
          <h2>{t('diag.log')}</h2>
          <Toggle
            checked={s.diagnostics.decisionLog}
            onChange={(v) => void save((x) => (x.diagnostics.decisionLog = v))}
            label={t('diag.logEnabled')}
            help={t('diag.logHelp')}
          />
        </div>
        {d.log.length === 0 ? (
          <p class="muted small">{t('diag.logEmpty')}</p>
        ) : (
          <div style={{ maxHeight: '320px', overflow: 'auto' }}>
            <table class="table small">
              <thead>
                <tr>
                  <th>{t('diag.when')}</th>
                  <th>{t('diag.where')}</th>
                  <th>{t('diag.what')}</th>
                  <th>{t('diag.url')}</th>
                </tr>
              </thead>
              <tbody>
                {[...d.log].reverse().map((e, i) => (
                  <tr key={i}>
                    <td class="nowrap">{new Date(e.at).toLocaleTimeString()}</td>
                    <td>{e.where}</td>
                    <td>{e.intervention}</td>
                    <td style={{ wordBreak: 'break-all' }}>{e.url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div class="row">
          <Button
            size="small"
            variant="ghost"
            onClick={async () => {
              await call('diag.clearLog', {});
              void reload();
            }}
          >
            {t('diag.clearLog')}
          </Button>
        </div>
      </div>
      <div class="card stack">
        <h2>{t('diag.report')}</h2>
        <p class="help">{t('diag.reportHelp')}</p>
        <label class="check small">
          <input
            type="checkbox"
            checked={urls}
            onChange={(e) => setUrls((e.target as HTMLInputElement).checked)}
          />
          {t('diag.includeUrls')}
        </label>
        <div class="row">
          <Button
            icon="copy"
            onClick={async () => {
              const r = await call('diag.report', { includeUrls: urls });
              toast((await copyText(r.text)) ? t('diag.copied') : t('data.copyFailed'));
            }}
          >
            {t('diag.copyReport')}
          </Button>
          <a class="btn ghost" href={NEW_ISSUE_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="external" />
            {t('diag.openIssue')}
            <span class="sr-only">{t('common.newTab')}</span>
          </a>
        </div>
        <details class="disclosure">
          <summary>{t('diag.counters')}</summary>
          <div class="body">
            <table class="table small">
              <tbody>
                {Object.entries(d.counters).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td class="num">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      {element}
    </div>
  );
}

export function SettingsPage({ sub }: { sub: string }) {
  const current = (SUBS.includes(sub as Sub) ? sub : 'general') as Sub;
  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <h1>{t('settings.title')}</h1>
        </div>
      </div>
      <nav class="subnav" aria-label={t('settings.sections')}>
        {SUBS.map((x) => (
          <a key={x} href={`#/settings/${x}`} aria-current={x === current ? 'page' : undefined}>
            {t(`settings.tab.${x}`)}
          </a>
        ))}
      </nav>
      {current === 'general' && <General />}
      {current === 'feedback' && <Feedback />}
      {current === 'time' && <TimeSettings />}
      {current === 'interventions' && <InterventionSettings />}
      {current === 'data' && <DataSettings />}
      {current === 'privacy' && <Privacy />}
      {current === 'diagnostics' && <Diagnostics />}
    </div>
  );
}
