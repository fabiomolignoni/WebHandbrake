/** Group editor (§8.4.4): What · Rules · Breaks & page · Protection · Advanced, with "In brief". */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { TEMPLATES } from '../../data/templates';
import {
  frictionIntervention,
  GROUP_COLORS,
  newGroup,
  newPolicy,
  pausePolicyFor,
  targetsFromSites,
} from '../../engine/defaults';
import type { Group, Policy, ProtectionLevel } from '../../engine/types';
import { hasErrors, validateGroup } from '../../engine/validate';
import { t } from '../../i18n/i18n';
import { formatDateTime } from '../../shared/format';
import { call } from '../../shared/rpc';
import { summarizeGroup } from '../../shared/summary';
import { Banner, Button, ColorDot, Dialog, Field, Select, Tabs, Toggle, toast } from '../../ui/components';
import { downloadText } from '../../ui/download';
import { GROUP_ICONS, Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { PauseEditor } from '../components/pause-editor';
import { PolicyCard } from '../components/policy';
import { TargetsEditor } from '../components/targets';
import { TestUrl } from '../components/test-url';
import { clone, useDashboard } from '../context';
import { navigate, setNavigationGuard } from '../router';

type TabId = 'what' | 'rules' | 'breaks' | 'protection' | 'advanced';

export function groupFromTemplate(templateId: string | null, level: ProtectionLevel): Group {
  const tpl = TEMPLATES.find((x) => x.id === templateId);
  if (!tpl) {
    return newGroup({
      name: '',
      policies: [newPolicy({ intervention: frictionIntervention() })],
      pause: pausePolicyFor(level),
    });
  }
  return newGroup({
    name: t(tpl.nameKey),
    color: tpl.color,
    icon: tpl.icon,
    targets: targetsFromSites(tpl.sites),
    policies: [
      newPolicy({ intervention: tpl.style === 'block' ? { type: 'block' } : frictionIntervention() }),
    ],
    pause: pausePolicyFor(tpl.style === 'block' ? 'strict' : level),
  });
}

const LEVELS: ProtectionLevel[] = ['soft', 'balanced', 'strict', 'locked'];

export function LevelExplanation({ level }: { level: ProtectionLevel }) {
  return (
    <div class="stack stack-sm">
      <p>{t(`level.${level}.desc`)}</p>
      <ul class="small text-2" style={{ margin: 0, paddingInlineStart: '18px' }}>
        <li>{t(`level.${level}.weaken`)}</li>
        <li>{t(`level.${level}.pauses`)}</li>
      </ul>
    </div>
  );
}

export function GroupEditorPage({ id, template }: { id: string; template: string | null }) {
  const { model } = useDashboard();
  const cfg = model.config;
  const advanced = cfg.settings.advanced;
  const existing = cfg.groups.find((g) => g.id === id) ?? null;
  const isNew = !existing;
  const base = useMemo(
    () => existing ?? groupFromTemplate(template, cfg.settings.protection.level),
    [id, template],
  );
  const [draft, setDraft] = useState<Group>(() => clone(base));
  // The version of the group the draft was last synchronised with: the draft is "dirty" only when
  // the user changed it, not when the group changed in the background.
  const [synced, setSynced] = useState<string>(() => JSON.stringify(base));
  const adopt = (g: Group) => {
    setDraft(clone(g));
    setSynced(JSON.stringify(g));
  };
  const [tab, setTab] = useState<TabId>('what');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lockPreview, setLockPreview] = useState<ProtectionLevel | null>(null);
  const flow = useSaveFlow();
  const reference = existing ?? base;
  const dirty = JSON.stringify(draft) !== synced;

  // Follow background changes (popup, context menu, another tab) when nothing is being edited.
  useEffect(() => {
    if (existing && !dirty) adopt(existing);
  }, [existing]);
  useEffect(() => {
    setNavigationGuard(() => dirty);
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      setNavigationGuard(null);
    };
  }, [dirty]);

  const issues = validateGroup(draft, cfg);
  const level = draft.protection ?? cfg.settings.protection.level;
  const set = (patch: Partial<Group>) => setDraft({ ...draft, ...patch });
  const setPolicy = (i: number, p: Policy) =>
    set({ policies: draft.policies.map((x, j) => (j === i ? p : x)) });
  const movePolicy = (i: number, dir: -1 | 1) => {
    const list = [...draft.policies];
    const [p] = list.splice(i, 1);
    list.splice(i + dir, 0, p);
    set({ policies: list });
  };

  const save = async () => {
    if (hasErrors(issues)) {
      toast(t('editor.fixErrors'));
      return;
    }
    setSaving(true);
    const next = clone(cfg);
    const idx = next.groups.findIndex((g) => g.id === draft.id);
    if (idx === -1) next.groups.push(draft);
    else next.groups[idx] = draft;
    try {
      await flow.run(call('config.save', { config: next }));
      setNavigationGuard(null);
      const fresh = (await call('config.get', {})).config.groups.find((g) => g.id === draft.id);
      if (fresh) adopt(fresh);
      if (isNew && fresh) navigate(`/groups/${draft.id}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    const next = clone(cfg);
    next.groups = next.groups.filter((g) => g.id !== draft.id);
    const ok = await flow.run(call('config.save', { config: next }));
    if (ok) {
      setNavigationGuard(null);
      navigate('/groups');
    }
  };

  const tabs: { value: TabId; label: string }[] = [
    { value: 'what', label: `① ${t('editor.tab.what')}` },
    { value: 'rules', label: `② ${t('editor.tab.rules')}` },
    { value: 'breaks', label: `③ ${t('editor.tab.breaks')}` },
    { value: 'protection', label: `④ ${t('editor.tab.protection')}` },
    { value: 'advanced', label: t('editor.tab.advanced') },
  ];
  const groupState = model.groups[draft.id];

  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div class="stack stack-sm">
          <a href="#/groups" class="small">
            ← {t('nav.groups')}
          </a>
          <h1 class="row nowrap">
            <ColorDot color={draft.color} />
            {draft.name || t('editor.newGroup')}
          </h1>
        </div>
        <div class="row">
          {!isNew && (
            <Toggle
              checked={draft.enabled}
              onChange={(enabled) => set({ enabled })}
              label={draft.enabled ? t('groups.enabled') : t('groups.disabled')}
            />
          )}
        </div>
      </div>
      {groupState?.lockedNow && (
        <Banner kind="info" icon="lock">
          {t('editor.lockedNow')}
        </Banner>
      )}
      <div class="editor">
        <div class="stack">
          <Tabs tabs={tabs} value={tab} onChange={setTab} label={t('editor.sections')} />
          {tab === 'what' && (
            <div class="stack stack-lg">
              <div class="card stack">
                <Field label={t('editor.name')}>
                  {(fid) => (
                    <input
                      id={fid}
                      class="input"
                      value={draft.name}
                      maxLength={80}
                      onInput={(e) => set({ name: (e.target as HTMLInputElement).value })}
                    />
                  )}
                </Field>
                <Field label={t('editor.note')} help={t('editor.noteHelp')}>
                  {(fid, d) => (
                    <textarea
                      id={fid}
                      aria-describedby={d}
                      class="textarea"
                      rows={2}
                      maxLength={500}
                      value={draft.note}
                      placeholder={t('editor.notePlaceholder')}
                      onInput={(e) => set({ note: (e.target as HTMLTextAreaElement).value })}
                    />
                  )}
                </Field>
                <div class="row">
                  <span class="label small">{t('editor.color')}</span>
                  <div class="chips" role="radiogroup" aria-label={t('editor.color')}>
                    {GROUP_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={draft.color === c}
                        class="chip"
                        aria-label={c}
                        onClick={() => set({ color: c })}
                      >
                        <ColorDot color={c} />
                      </button>
                    ))}
                  </div>
                  <span class="label small">{t('editor.icon')}</span>
                  <div class="chips" role="radiogroup" aria-label={t('editor.icon')}>
                    {GROUP_ICONS.map((ic) => (
                      <button
                        key={ic}
                        type="button"
                        role="radio"
                        aria-checked={draft.icon === ic}
                        class="chip"
                        aria-label={ic}
                        onClick={() => set({ icon: ic })}
                      >
                        <Icon name={ic} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div class="card stack">
                <h2>{t('editor.sites')}</h2>
                <TargetsEditor
                  targets={draft.targets}
                  onChange={(targets) => set({ targets })}
                  advanced={advanced}
                  hint={t('editor.sitesHint')}
                />
              </div>
              {cfg.lists.length > 0 && (
                <div class="card stack">
                  <h2>{t('editor.sharedLists')}</h2>
                  <p class="help">{t('editor.sharedListsHelp')}</p>
                  <div class="row">
                    {cfg.lists.map((l) => (
                      <label key={l.id} class="check">
                        <input
                          type="checkbox"
                          checked={draft.lists.includes(l.id)}
                          onChange={() =>
                            set({
                              lists: draft.lists.includes(l.id)
                                ? draft.lists.filter((x) => x !== l.id)
                                : [...draft.lists, l.id],
                            })
                          }
                        />
                        {l.name} <span class="muted small">({l.targets.length})</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {tab === 'rules' && (
            <div class="card stack">
              <h2>{t('editor.rules')}</h2>
              <p class="help">{t('editor.rulesHelp')}</p>
              {draft.policies.map((p, i) => (
                <PolicyCard
                  key={p.id}
                  policy={p}
                  index={i}
                  count={draft.policies.length}
                  advanced={advanced}
                  open={draft.policies.length === 1 && isNew}
                  onChange={(np) => setPolicy(i, np)}
                  onMove={(dir) => movePolicy(i, dir)}
                  onRemove={() => set({ policies: draft.policies.filter((_, j) => j !== i) })}
                />
              ))}
              <div class="policy">
                <div class="policy-head muted">
                  <span class="policy-index" aria-hidden="true">
                    ∗
                  </span>
                  <span>{t('editor.otherwise')}</span>
                </div>
              </div>
              <div class="row">
                <Button
                  icon="plus"
                  onClick={() =>
                    set({
                      policies: [
                        ...draft.policies,
                        newPolicy({
                          schedule: {
                            mode: 'during',
                            windows: [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }],
                          },
                          intervention: { type: 'block' },
                        }),
                      ],
                    })
                  }
                >
                  {t('editor.addSchedule')}
                </Button>
                <Button
                  icon="plus"
                  onClick={() =>
                    set({
                      policies: [
                        ...draft.policies,
                        newPolicy({
                          budget: { type: 'time', minutes: 30, period: { kind: 'day' } },
                          intervention: { type: 'block' },
                        }),
                      ],
                    })
                  }
                >
                  {t('editor.addLimit')}
                </Button>
                <Button
                  icon="plus"
                  variant="ghost"
                  onClick={() =>
                    set({
                      policies: [...draft.policies, newPolicy({ intervention: frictionIntervention() })],
                    })
                  }
                >
                  {t('editor.addAlways')}
                </Button>
              </div>
            </div>
          )}
          {tab === 'breaks' && (
            <div class="stack stack-lg">
              <div class="card stack">
                <h2>{t('editor.breaks')}</h2>
                <PauseEditor
                  value={draft.pause}
                  onChange={(pause) => set({ pause })}
                  hasPassword={model.hasPassword}
                />
              </div>
              <div class="card stack">
                <h2>{t('editor.page')}</h2>
                <Field label={t('editor.message')} help={t('editor.messageHelp')}>
                  {(fid, d) => (
                    <textarea
                      id={fid}
                      aria-describedby={d}
                      class="textarea"
                      rows={3}
                      maxLength={2000}
                      value={draft.message}
                      onInput={(e) => set({ message: (e.target as HTMLTextAreaElement).value })}
                    />
                  )}
                </Field>
                <Toggle
                  checked={draft.options.timer}
                  onChange={(timer) => set({ options: { ...draft.options, timer } })}
                  label={t('editor.timer')}
                  help={t('editor.timerHelp')}
                />
              </div>
            </div>
          )}
          {tab === 'protection' && (
            <div class="card stack">
              <h2>{t('editor.protection')}</h2>
              <Field
                label={t('editor.level')}
                help={t('editor.levelHelp', { level: t(`level.${cfg.settings.protection.level}`) })}
              >
                {(fid, d) => (
                  <Select<string>
                    id={fid}
                    describedBy={d}
                    value={draft.protection ?? 'global'}
                    onChange={(v) => {
                      if (v === 'locked') setLockPreview('locked');
                      else
                        set({
                          protection: v === 'global' ? null : (v as ProtectionLevel),
                          protectionUntil: null,
                        });
                    }}
                    options={[
                      {
                        value: 'global',
                        label: t('editor.levelGlobal', {
                          level: t(`level.${cfg.settings.protection.level}`),
                        }),
                      },
                      ...LEVELS.map((l) => ({ value: l, label: t(`level.${l}`) })),
                    ]}
                  />
                )}
              </Field>
              <LevelExplanation level={level} />
              {draft.protection === 'locked' && draft.protectionUntil && (
                <p class="small">
                  {t('editor.lockedUntil', { when: formatDateTime(draft.protectionUntil) })}
                </p>
              )}
            </div>
          )}
          {tab === 'advanced' && (
            <div class="card stack">
              <h2>{t('editor.advanced')}</h2>
              <Field label={t('editor.privacy')} help={t('editor.privacyHelp')}>
                {(fid, d) => (
                  <Select<Group['options']['privacy']>
                    id={fid}
                    describedBy={d}
                    value={draft.options.privacy}
                    onChange={(privacy) => set({ options: { ...draft.options, privacy } })}
                    options={[
                      { value: 'all', label: t('editor.privacy.all') },
                      { value: 'normal', label: t('editor.privacy.normal') },
                      { value: 'private', label: t('editor.privacy.private') },
                    ]}
                  />
                )}
              </Field>
              <Field label={t('editor.tabs')} help={t('editor.tabsHelp')}>
                {(fid, d) => (
                  <Select<Group['options']['tabs']>
                    id={fid}
                    describedBy={d}
                    value={draft.options.tabs}
                    onChange={(tabsMode) => set({ options: { ...draft.options, tabs: tabsMode } })}
                    options={[
                      { value: 'all', label: t('editor.tabs.all') },
                      { value: 'active', label: t('editor.tabs.active') },
                      { value: 'inactive', label: t('editor.tabs.inactive') },
                    ]}
                  />
                )}
              </Field>
              <Toggle
                checked={draft.options.embeds}
                onChange={(embeds) => set({ options: { ...draft.options, embeds } })}
                label={t('editor.embeds')}
                help={t('editor.embedsHelp')}
              />
              <Toggle
                checked={draft.options.quickSession}
                onChange={(quickSession) => set({ options: { ...draft.options, quickSession } })}
                label={t('editor.quickSession')}
                help={t('editor.quickSessionHelp')}
              />
              {!advanced && <p class="help">{t('editor.advancedModeHint')}</p>}
            </div>
          )}
          <div class="sticky-actions row between">
            <div class="row">
              <Button variant="primary" onClick={save} disabled={saving || (!dirty && !isNew)}>
                {isNew ? t('editor.create') : t('editor.save')}
              </Button>
              <Button variant="ghost" onClick={() => (dirty ? adopt(reference) : navigate('/groups'))}>
                {dirty ? t('editor.discard') : t('common.close')}
              </Button>
              {dirty && <span class="small muted">{t('editor.unsaved')}</span>}
            </div>
            {!isNew && (
              <div class="row">
                <Button
                  size="small"
                  variant="ghost"
                  icon="download"
                  onClick={async () => {
                    const r = await call('group.export', { groupId: draft.id });
                    downloadText(r.filename, r.text);
                  }}
                >
                  {t('groups.export')}
                </Button>
                <Button size="small" variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
                  {t('groups.delete')}
                </Button>
              </div>
            )}
          </div>
        </div>
        <aside class="editor-side" aria-label={t('editor.inBrief')}>
          <div class="card stack stack-sm">
            <h3>{t('editor.inBrief')}</h3>
            {summarizeGroup(draft).map((line, i) => (
              <p key={i} class="small">
                {line}
              </p>
            ))}
            <p class="small muted">{t('editor.subdomainsNote')}</p>
          </div>
          {issues.length > 0 && (
            <div class="stack stack-sm">
              {issues.map((iss, i) => (
                <Banner
                  key={i}
                  kind={iss.level === 'error' ? 'danger' : iss.level === 'warning' ? 'warning' : 'info'}
                >
                  <span class="small">{t(iss.key, iss.params)}</span>
                </Banner>
              ))}
            </div>
          )}
          <div class="card stack stack-sm">
            <h3>{t('test.title')}</h3>
            <TestUrl draft={draft} groups={cfg.groups} />
          </div>
        </aside>
      </div>
      {confirmDelete && (
        <Dialog
          open
          onClose={() => setConfirmDelete(false)}
          title={t('groups.deleteTitle', { name: draft.name })}
          actions={
            <>
              <Button variant="primary" onClick={() => setConfirmDelete(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={remove}>
                {t('groups.delete')}
              </Button>
            </>
          }
        >
          <p>{t('groups.deleteBody')}</p>
        </Dialog>
      )}
      {lockPreview && (
        <LockedPreview
          onCancel={() => setLockPreview(null)}
          onConfirm={(until) => {
            set({ protection: 'locked', protectionUntil: until });
            setLockPreview(null);
          }}
        />
      )}
      {flow.element}
    </div>
  );
}

/** ONB-07: just-in-time explanation before choosing the Locked level. */
export function LockedPreview({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (until: number) => void;
}) {
  const [date, setDate] = useState(() => {
    const d = new Date(Date.now() + 7 * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [ack, setAck] = useState(false);
  const until = new Date(`${date}T00:00`).getTime();
  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('locked.title')}
      actions={
        <>
          <Button variant="primary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!ack || !(until > Date.now())} onClick={() => onConfirm(until)}>
            {t('locked.confirm')}
          </Button>
        </>
      }
    >
      <div class="stack">
        <p>{t('locked.body')}</p>
        <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
          <li>{t('locked.point1')}</li>
          <li>{t('locked.point2')}</li>
          <li>{t('locked.point3')}</li>
        </ul>
        <Field label={t('locked.until')}>
          {(fid) => (
            <input
              id={fid}
              type="date"
              class="input inline"
              value={date}
              onInput={(e) => setDate((e.target as HTMLInputElement).value)}
            />
          )}
        </Field>
        <label class="check">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck((e.target as HTMLInputElement).checked)}
          />
          {t('locked.ack')}
        </label>
      </div>
    </Dialog>
  );
}
