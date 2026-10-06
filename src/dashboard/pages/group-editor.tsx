/**
 * Group editor (§8.4.4, docs/ux-redesign.md §6.5): everything about a group on one page — identity,
 * sites, rules, breaks, block page, protection and advanced options — with a section nav, a live
 * "In brief" summary, "Test a URL" and a sticky save bar.
 */

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
import { describeCondition, describeIntervention } from '../../shared/summary';
import {
  Banner,
  Button,
  Dialog,
  Field,
  GroupTile,
  Menu,
  RadioCards,
  Select,
  StatusPill,
  Toggle,
  toast,
} from '../../ui/components';
import { downloadText } from '../../ui/download';
import { GROUP_ICONS, Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { interventionIcon, toneOf } from '../../ui/status';
import { PauseEditor } from '../components/pause-editor';
import { PolicyCard } from '../components/policy';
import { TargetsEditor } from '../components/targets';
import { TestUrl } from '../components/test-url';
import { clone, useDashboard } from '../context';
import { navigate, setNavigationGuard } from '../router';

const SECTIONS = ['sites', 'rules', 'breaks', 'page', 'protection', 'advanced'] as const;
type SectionId = (typeof SECTIONS)[number];

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
    policies: [newPolicy({ intervention: frictionIntervention() })],
    pause: pausePolicyFor(level),
  });
}

const LEVELS: ProtectionLevel[] = ['soft', 'balanced', 'strict', 'locked'];

export function levelIcon(l: ProtectionLevel): string {
  return { soft: 'leaf', balanced: 'shield', strict: 'shield-check', locked: 'lock' }[l];
}

export function LevelExplanation({ level }: { level: ProtectionLevel }) {
  return (
    <div class="stack stack-sm">
      <p>{t(`level.${level}.desc`)}</p>
      <ul class="small text-2 bullets">
        <li>{t(`level.${level}.weaken`)}</li>
        <li>{t(`level.${level}.pauses`)}</li>
      </ul>
    </div>
  );
}

/** Highlights the section currently in view (scroll spy). */
function useCurrentSection(): SectionId {
  const [current, setCurrent] = useState<SectionId>('sites');
  useEffect(() => {
    const onScroll = () => {
      let found: SectionId = 'sites';
      for (const id of SECTIONS) {
        const el = document.getElementById(`sec-${id}`);
        if (el && el.getBoundingClientRect().top < 140) found = id;
      }
      // At the bottom of the page the last sections cannot reach the top.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4)
        found = SECTIONS[SECTIONS.length - 1];
      setCurrent(found);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return current;
}

function SectionNav() {
  const current = useCurrentSection();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <nav class="section-nav" aria-label={t('editor.sections')}>
      {SECTIONS.map((id) => (
        <button
          key={id}
          type="button"
          aria-current={current === id ? 'true' : undefined}
          onClick={() => {
            const el = document.getElementById(`sec-${id}`);
            el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
            el?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
          }}
        >
          {t(`editor.section.${id}`)}
        </button>
      ))}
    </nav>
  );
}

function SectionHead({ id, title, sub }: { id: SectionId; title: string; sub?: string }) {
  return (
    <div class="card-head">
      <div>
        <h2 id={`sec-${id}-title`} tabIndex={-1}>
          {title}
        </h2>
        {sub && <p class="card-sub">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * A draft handed over by the creation wizard ("Customise all options first"): the full editor
 * opens with it instead of an empty rule. Kept in memory only, consumed once.
 */
let handoff: Group | null = null;
export function setEditorHandoff(g: Group) {
  handoff = g;
}
function takeHandoff(): Group | null {
  const g = handoff;
  handoff = null;
  return g;
}

/** "In brief": each condition as a sentence with the tone of what happens (G5, SCH-04). */
export function InBrief({ g }: { g: Group }) {
  const last = g.policies[g.policies.length - 1];
  const catchAll = last && last.schedule.mode === 'always' && !last.budget;
  return (
    <div class="stack stack-sm">
      {g.policies.length === 0 && <p class="small">{t('summary.noPolicies')}</p>}
      {g.policies.map((p, i) => (
        <div key={p.id} class="stack stack-xs">
          <span class="small">
            <span class="muted num">{i + 1}. </span>
            {describeCondition(p)}
          </span>
          <span>
            <StatusPill small tone={toneOf(p.intervention.type)} icon={interventionIcon(p.intervention.type)}>
              {describeIntervention(p.intervention)}
            </StatusPill>
          </span>
        </div>
      ))}
      {g.policies.length > 0 && !catchAll && <p class="small muted">{t('summary.otherwise')}</p>}
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
    () => existing ?? takeHandoff() ?? groupFromTemplate(template, cfg.settings.protection.level),
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
  const [look, setLook] = useState(isNew && !template && !base.targets.length);
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
  const errors = issues.filter((i) => i.level === 'error').length;
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
  const addPolicy = (p: Policy) => set({ policies: [...draft.policies, p] });

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

  /** The on/off switch takes effect at once, like every switch (NN/g), without saving the draft. */
  const setEnabled = async (enabled: boolean) => {
    const next = clone(cfg);
    next.groups = next.groups.map((g) => (g.id === draft.id ? { ...g, enabled } : g));
    if (await flow.run(call('config.save', { config: next }))) {
      setDraft((d) => ({ ...d, enabled }));
      setSynced((s) => JSON.stringify({ ...JSON.parse(s), enabled }));
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

  const groupState = model.groups[draft.id];

  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <a href="#/groups" class="back quiet">
          <Icon name="chevron-left" />
          {t('nav.groups')}
        </a>
      </div>
      {groupState?.lockedNow && (
        <Banner kind="info" icon="lock">
          {t('editor.lockedNow')}
        </Banner>
      )}
      <div class="editor">
        <div class="stack stack-lg">
          <section class="card stack" aria-label={t('editor.identity')}>
            <div class="identity">
              <button
                type="button"
                class="identity-tile"
                aria-expanded={look}
                aria-label={t('editor.look')}
                title={t('editor.look')}
                onClick={() => setLook(!look)}
              >
                <GroupTile color={draft.color} icon={draft.icon} size={56} />
              </button>
              <div class="stack stack-xs" style={{ minWidth: 0 }}>
                <div class="row nowrap">
                  <div class="grow">
                    <label for="group-name" class="sr-only">
                      {t('editor.name')}
                    </label>
                    <input
                      id="group-name"
                      class="input name-input"
                      value={draft.name}
                      maxLength={80}
                      placeholder={t('editor.namePlaceholder')}
                      onInput={(e) => set({ name: (e.target as HTMLInputElement).value })}
                    />
                  </div>
                  {!isNew && (
                    <Toggle
                      compact
                      checked={draft.enabled}
                      onChange={(enabled) => void setEnabled(enabled)}
                      label={draft.enabled ? t('groups.enabled') : t('groups.disabled')}
                    />
                  )}
                </div>
                <label for="group-note" class="small text-2" style={{ fontWeight: 600 }}>
                  {t('editor.note')}
                </label>
                <textarea
                  id="group-note"
                  aria-describedby="group-note-help"
                  class="textarea note-input"
                  rows={2}
                  maxLength={500}
                  value={draft.note}
                  placeholder={t('editor.notePlaceholder')}
                  onInput={(e) => set({ note: (e.target as HTMLTextAreaElement).value })}
                />
                <span class="help" id="group-note-help">
                  {t('editor.noteHelp')}
                </span>
              </div>
            </div>
            {look && (
              <div class="option-panel">
                <div class="field">
                  <span class="label small" id="color-label">
                    {t('editor.color')}
                  </span>
                  <RadioCards
                    value={draft.color}
                    onChange={(color) => set({ color })}
                    label={t('editor.color')}
                    class="picker"
                    itemClass="swatch"
                    options={GROUP_COLORS.map((c) => ({ value: c }))}
                    render={(o) => (
                      <>
                        <span style={{ background: o.value }} aria-hidden="true" />
                        <span class="sr-only">
                          {t('editor.colorN', { n: GROUP_COLORS.indexOf(o.value) + 1 })}
                        </span>
                      </>
                    )}
                  />
                </div>
                <div class="field">
                  <span class="label small">{t('editor.icon')}</span>
                  <RadioCards
                    value={draft.icon}
                    onChange={(icon) => set({ icon })}
                    label={t('editor.icon')}
                    class="picker"
                    itemClass="icon-choice"
                    options={GROUP_ICONS.map((ic) => ({ value: ic }))}
                    render={(o) => <Icon name={o.value} label={t(`icon.${o.value}`)} />}
                  />
                </div>
              </div>
            )}
          </section>

          <SectionNav />

          <section id="sec-sites" class="card editor-section" aria-labelledby="sec-sites-title">
            <SectionHead id="sites" title={t('editor.sites')} sub={t('editor.sitesHint')} />
            <TargetsEditor
              targets={draft.targets}
              onChange={(targets) => set({ targets })}
              advanced={advanced}
            />
            {cfg.lists.length > 0 && (
              <div class="stack stack-sm" style={{ marginTop: '20px' }}>
                <h3>{t('editor.sharedLists')}</h3>
                <p class="help">{t('editor.sharedListsHelp')}</p>
                <div class="chips" role="group" aria-label={t('editor.sharedLists')}>
                  {cfg.lists.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      class="chip"
                      aria-pressed={draft.lists.includes(l.id)}
                      onClick={() =>
                        set({
                          lists: draft.lists.includes(l.id)
                            ? draft.lists.filter((x) => x !== l.id)
                            : [...draft.lists, l.id],
                        })
                      }
                    >
                      {l.name} <span class="muted small">({l.targets.length})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section id="sec-rules" class="card editor-section" aria-labelledby="sec-rules-title">
            <SectionHead id="rules" title={t('editor.rules')} sub={t('editor.rulesHelp')} />
            <div class="stack stack-sm">
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
              <div class="policy otherwise">
                <div class="policy-head muted">
                  <span class="policy-index" aria-hidden="true">
                    ∗
                  </span>
                  <span class="small">{t('editor.otherwise')}</span>
                </div>
              </div>
              <div class="add-rule">
                <span class="small text-2 strong">{t('editor.addRule')}</span>
                <Button
                  size="small"
                  icon="calendar"
                  onClick={() =>
                    addPolicy(
                      newPolicy({
                        schedule: {
                          mode: 'during',
                          windows: [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }],
                        },
                        intervention: { type: 'block' },
                      }),
                    )
                  }
                >
                  {t('editor.addSchedule')}
                </Button>
                <Button
                  size="small"
                  icon="hourglass"
                  onClick={() =>
                    addPolicy(
                      newPolicy({
                        budget: { type: 'time', minutes: 30, period: { kind: 'day' } },
                        intervention: { type: 'block' },
                      }),
                    )
                  }
                >
                  {t('editor.addLimit')}
                </Button>
                <Button
                  size="small"
                  icon="wind"
                  onClick={() => addPolicy(newPolicy({ intervention: frictionIntervention() }))}
                >
                  {t('editor.addAlways')}
                </Button>
              </div>
            </div>
          </section>

          <section id="sec-breaks" class="card editor-section" aria-labelledby="sec-breaks-title">
            <SectionHead id="breaks" title={t('editor.breaks')} sub={t('editor.breaksHelp')} />
            <PauseEditor
              value={draft.pause}
              onChange={(pause) => set({ pause })}
              hasPassword={model.hasPassword}
            />
          </section>

          <section id="sec-page" class="card editor-section stack" aria-labelledby="sec-page-title">
            <SectionHead id="page" title={t('editor.page')} sub={t('editor.pageHelp')} />
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
          </section>

          <section
            id="sec-protection"
            class="card editor-section stack"
            aria-labelledby="sec-protection-title"
          >
            <SectionHead id="protection" title={t('editor.protection')} />
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
            <div class="option-panel row nowrap top" style={{ gap: '12px' }}>
              <Icon name={levelIcon(level)} />
              <LevelExplanation level={level} />
            </div>
            {draft.protection === 'locked' && draft.protectionUntil && (
              <p class="small">{t('editor.lockedUntil', { when: formatDateTime(draft.protectionUntil) })}</p>
            )}
          </section>

          <section id="sec-advanced" class="card editor-section" aria-labelledby="sec-advanced-title">
            <details class="disclosure bare">
              <summary>
                <h2 id="sec-advanced-title" tabIndex={-1} style={{ display: 'inline' }}>
                  {t('editor.advanced')}
                </h2>
              </summary>
              <div class="body stack">
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
                <div class="settings-list">
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
                </div>
                {!advanced && <p class="help">{t('editor.advancedModeHint')}</p>}
              </div>
            </details>
          </section>

          <div class="sticky-actions row between">
            <div class="row">
              <Button variant="primary" onClick={save} disabled={saving || (!dirty && !isNew)}>
                {isNew ? t('editor.create') : t('editor.save')}
              </Button>
              <Button variant="ghost" onClick={() => (dirty ? adopt(reference) : navigate('/groups'))}>
                {dirty ? t('editor.discard') : t('common.close')}
              </Button>
              {dirty && <span class="unsaved">{t('editor.unsaved')}</span>}
              {errors > 0 && <span class="error-text">{t('editor.errorsCount', { count: errors })}</span>}
            </div>
            {!isNew && (
              <Menu
                up
                label={t('editor.moreActions')}
                items={[
                  {
                    label: t('groups.export'),
                    icon: 'download',
                    onSelect: async () => {
                      const r = await call('group.export', { groupId: draft.id });
                      downloadText(r.filename, r.text);
                    },
                  },
                  'separator',
                  {
                    label: t('groups.delete'),
                    icon: 'trash',
                    danger: true,
                    onSelect: () => setConfirmDelete(true),
                  },
                ]}
              />
            )}
          </div>
        </div>
        <aside class="editor-side" aria-label={t('editor.inBrief')}>
          <div class="card stack stack-sm">
            <h3>{t('editor.inBrief')}</h3>
            <p class="small text-2">
              {t('groups.sites', { count: draft.targets.filter((x) => !x.allow).length })}
              {draft.targets.some((x) => x.allow) &&
                ` · ${t('editor.exceptionsCount', { count: draft.targets.filter((x) => x.allow).length })}`}
            </p>
            <InBrief g={draft} />
            <p class="tiny muted">{t('editor.subdomainsNote')}</p>
          </div>
          {issues.length > 0 && (
            <section class="stack stack-sm" aria-label={t('editor.issues')}>
              {issues.map((iss, i) => (
                <Banner
                  key={i}
                  kind={iss.level === 'error' ? 'danger' : iss.level === 'warning' ? 'warning' : 'info'}
                >
                  <span class="small">{t(iss.key, iss.params)}</span>
                </Banner>
              ))}
            </section>
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
        <ul class="small bullets">
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
