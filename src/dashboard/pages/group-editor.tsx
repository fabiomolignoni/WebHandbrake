/**
 * Rule editor: the parts of a rule as the steps of the creation wizard, with the
 * same progress bar, step cards and save bar. Editing is not linear, so every part can be opened
 * at any time: the editor opens on **Overview**, which states the rule and links each part
 * ("Change"), like the wizard's review. One draft covers every part and is saved at once.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TEMPLATES } from '../../data/templates';
import {
  addTemplate,
  canHaveBreaks,
  DEFAULT_PROTECTION,
  frictionIntervention,
  GROUP_COLORS,
  newGroup,
  newPolicy,
  targetKey,
  targetsFromLines,
} from '../../engine/defaults';
import { clone } from '../../engine/json';
import type { Group, Policy, Protection, Target } from '../../engine/types';
import { hasErrors, type Issue, validateGroup } from '../../engine/validate';
import { t } from '../../i18n/i18n';
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
import { interventionIcon, LADDER, toneOf } from '../../ui/status';
import { PauseEditor, pauseRulesSummary } from '../components/pause-editor';
import { PolicyCard } from '../components/policy';
import { ProtectionPicker, protectionIcon, protectionLabel } from '../components/protection-picker';
import { TargetsEditor } from '../components/targets';
import { TestUrl } from '../components/test-url';
import { useDashboard } from '../context';
import { sitesPhrase } from '../plan';
import { navigate, setNavigationGuard } from '../router';

// When a condition applies and what happens then are two parts, as in the wizard; the breaks of a
// rule that blocks are part of what happens.
const STEPS = ['overview', 'sites', 'when', 'how', 'protection', 'details'] as const;
type StepId = (typeof STEPS)[number];

const STEP_ICON: Record<StepId, string> = {
  overview: 'list',
  sites: 'globe',
  when: 'calendar',
  how: 'brake',
  protection: 'shield',
  details: 'sliders',
};
const STEP_LABEL: Record<StepId, string> = {
  overview: 'editor.step.overview',
  sites: 'editor.step.sites',
  when: 'wizard.step.when',
  how: 'wizard.step.how',
  protection: 'editor.step.protection',
  details: 'editor.step.details',
};
const STEP_TITLE: Record<StepId, string> = {
  overview: 'editor.overview.title',
  sites: 'wizard.sites.title',
  when: 'wizard.when.title',
  how: 'wizard.how.title',
  protection: 'wizard.protection.title',
  details: 'editor.details.title',
};
const STEP_INTRO: Record<StepId, string> = {
  overview: 'editor.overview.intro',
  sites: 'editor.sitesHint',
  when: 'editor.when.intro',
  how: 'editor.how.intro',
  protection: 'wizard.protection.intro',
  details: 'editor.details.intro',
};
/** The Next button, by the part it opens. */
const NEXT_LABEL: Partial<Record<StepId, string>> = {
  sites: 'editor.next.sites',
  when: 'wizard.next.when',
  how: 'wizard.next.how',
  protection: 'editor.next.protection',
  details: 'editor.next.details',
};
/**
 * Links to parts that are gone: conditions (`?step=rules`) open when they apply, and breaks
 * (`?step=breaks`) what happens.
 */
const OLD_STEPS: Record<string, StepId> = { rules: 'when', breaks: 'how' };

/** What each step edits: a step is marked when it changed. */
const STEP_PART: Record<StepId, (g: Group) => unknown> = {
  overview: () => null,
  sites: (g) => g.targets,
  when: (g) => g.policies.map((p) => [p.id, p.schedule, p.budget]),
  how: (g) => [g.policies.map((p) => [p.id, p.intervention]), g.pause],
  protection: (g) => g.protection,
  details: (g) => [g.name, g.note, g.color, g.icon, g.message, g.options],
};

/** Problems with what happens; the other problems of a condition are with when it applies. */
const HOW_ISSUES = new Set([
  'validate.redirectUrl',
  'validate.phrase',
  'validate.askChoices',
  'validate.onlyTracking',
  'validate.pauseDuration',
]);

/** The step where a problem found by validateGroup() is fixed. */
function stepOf(issue: Issue): StepId {
  if (HOW_ISSUES.has(issue.key)) return 'how';
  if (issue.policy !== undefined || issue.key === 'validate.noPolicies') return 'when';
  if (issue.key === 'validate.noName') return 'details';
  return 'sites';
}

export function groupFromTemplate(templateId: string | null, protection: Protection): Group {
  const tpl = TEMPLATES.find((x) => x.id === templateId);
  if (!tpl) {
    return newGroup({
      name: '',
      policies: [newPolicy({ intervention: frictionIntervention() })],
      protection,
    });
  }
  return newGroup({
    name: t(tpl.nameKey),
    color: tpl.color,
    icon: tpl.icon,
    targets: addTemplate([], tpl.entries),
    policies: [newPolicy({ intervention: frictionIntervention() })],
    protection,
  });
}

function endsWithCatchAll(policies: Policy[]): boolean {
  const last = policies[policies.length - 1];
  return Boolean(last && last.schedule.mode === 'always' && !last.budget);
}

/** The tone of the strictest thing the rule does, for its plan card. */
function ruleTone(g: Group): string {
  if (!g.enabled) return 'neutral';
  const strictest = g.policies.reduce<number>(
    (max, p) => Math.max(max, LADDER.indexOf(p.intervention.type)),
    -1,
  );
  return strictest === -1 ? 'neutral' : toneOf(LADDER[strictest]);
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

/** Each condition as a sentence with the tone of what happens. */
function Conditions({ g }: { g: Group }) {
  return (
    <ol class="plan-conditions">
      {g.policies.length === 0 && <li class="small">{t('summary.noPolicies')}</li>}
      {g.policies.map((p) => (
        <li key={p.id}>
          <span class="small">{describeCondition(p)}</span>
          <StatusPill small tone={toneOf(p.intervention.type)} icon={interventionIcon(p.intervention.type)}>
            {describeIntervention(p.intervention)}
          </StatusPill>
        </li>
      ))}
      {g.policies.length > 0 && !endsWithCatchAll(g.policies) && (
        <li class="small muted otherwise">{t('summary.otherwise')}</li>
      )}
    </ol>
  );
}

export function GroupEditorPage({
  id,
  template,
  step: initialStep,
}: {
  id: string;
  template: string | null;
  /** The part to open first (`?step=`), for links such as Protection's "Change". */
  step?: string | null;
}) {
  const { model } = useDashboard();
  const cfg = model.config;
  const advanced = cfg.settings.advanced;
  const existing = cfg.groups.find((g) => g.id === id) ?? null;
  const isNew = !existing;
  const base = useMemo(
    () => existing ?? takeHandoff() ?? groupFromTemplate(template, DEFAULT_PROTECTION),
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
  const [step, setStep] = useState<StepId>(() =>
    STEPS.includes(initialStep as StepId)
      ? (initialStep as StepId)
      : (OLD_STEPS[initialStep ?? ''] ?? 'overview'),
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const flow = useSaveFlow();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const reference = existing ?? base;
  const dirty = JSON.stringify(draft) !== synced;
  const saved = useMemo(() => JSON.parse(synced) as Group, [synced]);

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
  // Focus follows the step, as in the wizard; opening the editor leaves it in place.
  useEffect(() => {
    if (!moved.current) return;
    window.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: true });
  }, [step]);
  const go = (s: StepId) => {
    moved.current = true;
    setStep(s);
  };

  const issues = validateGroup(draft);
  const errors = issues.filter((i) => i.level === 'error').length;
  const changed = (s: StepId) => JSON.stringify(STEP_PART[s](draft)) !== JSON.stringify(STEP_PART[s](saved));
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
      const first = issues.find((i) => i.level === 'error');
      if (first && stepOf(first) !== step) go(stepOf(first));
      return;
    }
    setSaving(true);
    const next = clone(cfg);
    const idx = next.groups.findIndex((g) => g.id === draft.id);
    if (idx === -1) next.groups.push(draft);
    else {
      // A protection left as it was loaded is saved as it is now, which may be newer than the
      // draft (another tab): only a protection chosen here is a change.
      const keep = JSON.stringify(draft.protection) === JSON.stringify(saved.protection);
      next.groups[idx] = keep ? { ...draft, protection: next.groups[idx].protection } : draft;
    }
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
  const index = STEPS.indexOf(step);
  const stepIssues = step === 'overview' ? issues : issues.filter((i) => stepOf(i) === step);
  const nextStep: StepId | null = STEPS[index + 1] ?? null;

  return (
    <div class="stack stack-lg wizard-page editor-page">
      <div class="page-head">
        <div style={{ minWidth: 0 }}>
          <a href="#/groups" class="back quiet">
            <Icon name="chevron-left" />
            {t('nav.groups')}
          </a>
          <div class="editor-title">
            <GroupTile color={draft.color} icon={draft.icon} size={40} />
            <h1 class="ellipsis">{isNew ? t('wizard.title') : draft.name.trim() || t('editor.unnamed')}</h1>
          </div>
        </div>
        {!isNew && (
          <div class="row nowrap">
            <Toggle
              compact
              checked={draft.enabled}
              onChange={(enabled) => void setEnabled(enabled)}
              label={draft.enabled ? t('groups.enabled') : t('groups.disabled')}
            />
            <Menu
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
          </div>
        )}
      </div>

      <nav aria-label={t('editor.sections')}>
        <ol class="wizard-progress editor-steps">
          {STEPS.map((id) => {
            const bad = issues.some((i) => i.level === 'error' && id !== 'overview' && stepOf(i) === id);
            const edited = changed(id);
            return (
              <li key={id} class={id === step ? 'current' : ''}>
                <button type="button" aria-current={id === step ? 'step' : undefined} onClick={() => go(id)}>
                  <span class="num" aria-hidden="true">
                    <Icon name={STEP_ICON[id]} />
                  </span>
                  <span class="label">{t(STEP_LABEL[id])}</span>
                  {(bad || edited) && (
                    <span class={`mark${bad ? ' error' : ''}`}>
                      <span class="sr-only">
                        {' '}
                        — {bad ? t('editor.step.problem') : t('editor.step.changed')}
                      </span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {groupState?.lockedNow && (
        <Banner kind="info" icon="lock">
          {t('editor.lockedNow')}
        </Banner>
      )}

      <section class="card stack stack-lg" aria-labelledby="editor-step-title">
        <div>
          <p class="overline">{t('editor.partOf', { n: index + 1, total: STEPS.length })}</p>
          <h2 id="editor-step-title" ref={titleRef} tabIndex={-1}>
            {t(STEP_TITLE[step])}
          </h2>
          <p class="card-sub">{t(STEP_INTRO[step])}</p>
        </div>

        {step !== 'overview' && stepIssues.length > 0 && <IssueList issues={stepIssues} />}

        {step === 'overview' && <Overview draft={draft} issues={issues} onChange={go} />}

        {step === 'sites' && (
          <>
            <div class="field">
              <span class="label">{t('wizard.sites.yours')}</span>
              <TargetsEditor
                targets={draft.targets}
                onChange={(targets) => set({ targets })}
                advanced={advanced}
              />
            </div>
            <div class="field">
              <span class="label" id="editor-templates">
                {t('wizard.sites.templates')}
              </span>
              <span class="help">{t('editor.templatesHelp')}</span>
              <div class="chips" role="group" aria-labelledby="editor-templates">
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    class="chip"
                    aria-pressed={hasTemplate(draft.targets, tpl.entries)}
                    onClick={() => set({ targets: toggleTemplate(draft.targets, tpl.id) })}
                  >
                    <Icon name={tpl.icon} />
                    {t(tpl.nameKey)}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 'when' && (
          <div class="stack stack-sm">
            {draft.policies.map((p, i) => (
              <PolicyCard
                key={p.id}
                policy={p}
                index={i}
                count={draft.policies.length}
                part="when"
                advanced={advanced}
                open={draft.policies.length === 1}
                onChange={(np) => setPolicy(i, np)}
                onMove={(dir) => movePolicy(i, dir)}
                onRemove={() => set({ policies: draft.policies.filter((_, j) => j !== i) })}
              />
            ))}
            <Otherwise policies={draft.policies} />
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
        )}

        {step === 'how' && (
          <div class="stack stack-sm">
            {draft.policies.map((p, i) => (
              <PolicyCard
                key={p.id}
                policy={p}
                index={i}
                count={draft.policies.length}
                part="how"
                advanced={advanced}
                open={draft.policies.length === 1}
                onChange={(np) => setPolicy(i, np)}
              />
            ))}
            {draft.policies.length ? (
              <Otherwise policies={draft.policies} />
            ) : (
              <div class="option-panel row nowrap top" style={{ gap: '12px' }}>
                <Icon name="info" />
                <div class="stack stack-sm small">
                  <span>{t('editor.how.none')}</span>
                  <div>
                    <button type="button" class="link-btn small" onClick={() => go('when')}>
                      {t('editor.how.toWhen')}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {/* A break lifts a block only: a rule that never blocks has no breaks. */}
            {canHaveBreaks(draft) && (
              <section class="stack editor-breaks" aria-labelledby="editor-breaks-title">
                <h3 id="editor-breaks-title">{t('editor.breaks')}</h3>
                <PauseEditor
                  value={draft.pause}
                  onChange={(pause) => set({ pause })}
                  hasPassword={draft.protection.kind === 'password'}
                />
              </section>
            )}
          </div>
        )}

        {step === 'protection' && (
          <ProtectionPicker
            key={synced}
            value={draft.protection}
            onChange={(protection) => set({ protection })}
            groupId={draft.id}
            name={draft.name}
            label={t('editor.level')}
            breaks={canHaveBreaks(draft) && draft.pause.allowed}
          />
        )}

        {step === 'details' && (
          <>
            <div class="field">
              <label class="label" for="group-name">
                {t('editor.name')}
              </label>
              <input
                id="group-name"
                class="input"
                value={draft.name}
                maxLength={80}
                placeholder={t('editor.namePlaceholder')}
                onInput={(e) => set({ name: (e.target as HTMLInputElement).value })}
              />
            </div>
            <div class="field">
              <label class="label" for="group-note">
                {t('editor.note')}
              </label>
              <textarea
                id="group-note"
                aria-describedby="group-note-help"
                class="textarea"
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
            <details class="disclosure">
              <summary>
                <Icon name="palette" />
                {t('editor.look')}
              </summary>
              <div class="body stack">
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
            </details>
            <div class="stack">
              <div>
                <h3>{t('editor.page')}</h3>
                <p class="help">{t('editor.pageHelp')}</p>
              </div>
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
            <details class="disclosure">
              <summary>
                <Icon name="sliders" />
                {t('editor.advanced')}
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
          </>
        )}

        {nextStep && (
          <div class="row end">
            <button type="button" class="link-btn small row nowrap" onClick={() => go(nextStep)}>
              {t(NEXT_LABEL[nextStep] as string)}
              <Icon name="chevron-right" />
            </button>
          </div>
        )}
      </section>

      {step === 'overview' && (
        <section class="card stack stack-sm" aria-labelledby="editor-test-title">
          <h3 id="editor-test-title">{t('test.title')}</h3>
          <TestUrl draft={draft} groups={cfg.groups} />
        </section>
      )}

      <div class="sticky-actions row between">
        <Button variant="ghost" onClick={() => (dirty ? adopt(reference) : navigate('/groups'))}>
          {dirty ? t('editor.discard') : t('common.close')}
        </Button>
        <div class="row">
          {dirty && <span class="unsaved">{t('editor.unsaved')}</span>}
          {errors > 0 && <span class="error-text">{t('editor.errorsCount', { count: errors })}</span>}
          <Button variant="primary" icon="check" onClick={save} disabled={saving || (!dirty && !isNew)}>
            {isNew ? t('editor.create') : t('editor.save')}
          </Button>
        </div>
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
      {flow.element}
    </div>
  );
}

/** What happens when no condition applies; a last condition that always applies leaves nothing (#21). */
function Otherwise({ policies }: { policies: Policy[] }) {
  if (endsWithCatchAll(policies)) return null;
  return (
    <div class="policy otherwise">
      <div class="policy-head muted">
        <span class="policy-index" aria-hidden="true">
          ∗
        </span>
        <span class="small">{t('editor.otherwise')}</span>
      </div>
    </div>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <div class="stack stack-sm" role="group" aria-label={t('editor.issues')}>
      {issues.map((iss, i) => (
        <Banner
          key={i}
          kind={iss.level === 'error' ? 'danger' : iss.level === 'warning' ? 'warning' : 'info'}
        >
          <span class="small">{t(iss.key, iss.params)}</span>
        </Banner>
      ))}
    </div>
  );
}

/**
 * The wizard's review for a rule that exists: what the rule does as a plan, then each part with
 * its "Change" link (the "check your answers" pattern), and what to check before saving.
 */
function Overview({
  draft,
  issues,
  onChange,
}: {
  draft: Group;
  issues: Issue[];
  onChange: (s: StepId) => void;
}) {
  const sites = draft.targets.filter((x) => !x.allow);
  const exceptions = draft.targets.length - sites.length;
  const row = (id: StepId, value: preact.ComponentChildren) => (
    <div class="summary-row">
      <dt>{t(STEP_LABEL[id])}</dt>
      <dd>{value}</dd>
      <dd class="summary-action">
        <button type="button" class="link-btn small" onClick={() => onChange(id)}>
          {t('editor.change')}
          <span class="sr-only"> {t(STEP_LABEL[id])}</span>
        </button>
      </dd>
    </div>
  );
  return (
    <>
      <div class={`plan tone-${ruleTone(draft)}`}>
        <GroupTile color={draft.color} icon={draft.icon} size={48} />
        <div class="stack stack-sm" style={{ minWidth: 0 }}>
          <div class="row">
            <strong class="plan-name">{draft.name.trim() || t('editor.unnamed')}</strong>
            {!draft.enabled && (
              <StatusPill small tone="neutral" icon="pause">
                {t('groups.disabled')}
              </StatusPill>
            )}
          </div>
          <p class="small text-2">
            {sites.length
              ? t('editor.overview.on', { sites: sitesPhrase(draft.targets) })
              : t('editor.overview.noSites')}
          </p>
          <Conditions g={draft} />
          {draft.note.trim() && <p class="small quote">“{draft.note.trim()}”</p>}
        </div>
      </div>
      {issues.length > 0 && <IssueList issues={issues} />}
      <dl class="summary-list">
        {row(
          'sites',
          <>
            {sites.length ? t('groups.sites', { count: sites.length }) : t('editor.overview.noSites')}
            {exceptions > 0 && ` · ${t('editor.exceptionsCount', { count: exceptions })}`}
          </>,
        )}
        {row('when', t('editor.overview.conditions', { count: draft.policies.length }))}
        {row(
          'how',
          <span class="stack stack-xs">
            <span>
              {draft.policies.length
                ? [...new Set(draft.policies.map((x) => describeIntervention(x.intervention)))].join(' · ')
                : t('editor.overview.openNormally')}
            </span>
            {canHaveBreaks(draft) && <span>{pauseRulesSummary(draft.pause)}</span>}
          </span>,
        )}
        {row(
          'protection',
          <span class="row nowrap">
            <Icon name={protectionIcon(draft.protection.kind)} />
            {protectionLabel(draft.protection)}
          </span>,
        )}
        {row(
          'details',
          <>
            {draft.message.trim() ? t('editor.overview.message') : t('editor.overview.noMessage')}
            {!draft.note.trim() && ` · ${t('editor.overview.noReason')}`}
          </>,
        )}
      </dl>
    </>
  );
}

/** Whether every site of a ready-made list is in the rule (its exceptions may have been removed). */
function hasTemplate(targets: Target[], entries: string[]): boolean {
  const have = new Set(targets.map(targetKey));
  return targetsFromLines(entries).every((x) => x.allow || have.has(targetKey(x)));
}

/**
 * A ready-made list adds its missing entries; when all of its sites are there, it removes its
 * entries, except those that another complete ready-made list also has.
 */
function toggleTemplate(targets: Target[], id: string): Target[] {
  const tpl = TEMPLATES.find((x) => x.id === id);
  if (!tpl) return targets;
  if (!hasTemplate(targets, tpl.entries)) return addTemplate(targets, tpl.entries);
  const ownKeys = new Set(targetsFromLines(tpl.entries).map(targetKey));
  const kept = new Set(
    targetsFromLines(
      TEMPLATES.filter((x) => x.id !== id && hasTemplate(targets, x.entries)).flatMap((x) => x.entries),
    ).map(targetKey),
  );
  return targets.filter((x) => !ownKeys.has(targetKey(x)) || kept.has(targetKey(x)));
}
