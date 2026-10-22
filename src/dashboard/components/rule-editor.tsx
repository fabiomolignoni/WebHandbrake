/**
 * The rule editor: one interface to create a rule and to change it. A rule has six parts (Sites,
 * When, What happens, Details, Protection, Summary), each a card that asks the first questions;
 * whatever goes beyond them is in the part's "Advanced options", folded away unless the rule
 * already uses it. The parts build an if-then plan ("When I open these sites…, then…"), which the
 * summary states in a sentence.
 *
 * A new rule goes through the parts in order (a short wizard, NN/g: creating is infrequent and
 * done by people new to the concepts) and is kept for the session; the same parts create the
 * first rule in first run, with another top of the page. A rule that exists opens on its summary
 * ("check your answers", GOV.UK), every part can be opened at any time, and one draft covers every
 * part and is saved at once.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TEMPLATES } from '../../data/templates';
import {
  addTemplate,
  canHaveBreaks,
  DEFAULT_PROTECTION,
  defaultPause,
  frictionIntervention,
  GROUP_COLORS,
  newGroup,
  newPolicy,
  targetKey,
  targetsFromLines,
  withCountingGap,
} from '../../engine/defaults';
import { clone } from '../../engine/json';
import type { Group, Intervention, Policy, Protection, Target } from '../../engine/types';
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
import { useDashboard } from '../context';
import { rulePlan, sitesPhrase } from '../plan';
import { navigate, setNavigationGuard } from '../router';
import { optionsAdvanced } from '../rule-form';
import { AdvancedOptions } from './advanced';
import { InterventionPicker, type KeptInterventions } from './how-picker';
import { PauseEditor, pauseRulesSummary } from './pause-editor';
import { ConditionEditor, type ConditionMemo, PolicyCard } from './policy';
import { ProtectionPicker, protectionIcon, protectionLabel } from './protection-picker';
import { TargetsEditor } from './targets';
import { TestUrl } from './test-url';

// The name comes before the protection: a password or a partner code is set up for a named rule.
const STEPS = ['sites', 'when', 'how', 'details', 'protection', 'summary'] as const;
type StepId = (typeof STEPS)[number];

const STEP_ICON: Record<StepId, string> = {
  sites: 'globe',
  when: 'calendar',
  how: 'brake',
  protection: 'shield',
  details: 'edit',
  summary: 'list',
};
const STEP_LABEL: Record<StepId, string> = {
  sites: 'wizard.step.sites',
  when: 'wizard.step.when',
  how: 'wizard.step.how',
  protection: 'wizard.step.protection',
  details: 'editor.step.details',
  summary: 'editor.step.summary',
};
const STEP_TITLE: Record<Exclude<StepId, 'summary'>, string> = {
  sites: 'wizard.sites.title',
  when: 'wizard.when.title',
  how: 'wizard.how.title',
  protection: 'wizard.protection.title',
  details: 'editor.details.title',
};
const STEP_INTRO: Record<Exclude<StepId, 'summary'>, string> = {
  sites: 'wizard.sites.intro',
  when: 'wizard.when.intro',
  how: 'wizard.how.intro',
  protection: 'wizard.protection.intro',
  details: 'editor.details.intro',
};
/** The Next button, by the part it opens. */
const NEXT_LABEL: Record<Exclude<StepId, 'sites'>, string> = {
  when: 'wizard.next.when',
  how: 'wizard.next.how',
  protection: 'wizard.next.protection',
  details: 'editor.next.details',
  summary: 'editor.next.summary',
};
/**
 * Links to parts that are gone: conditions (`?step=rules`) open When, breaks (`?step=breaks`) What
 * happens, the overview the summary.
 */
const OLD_STEPS: Record<string, StepId> = { rules: 'when', breaks: 'how', overview: 'summary' };

/** What each part edits: a part is marked when it changed. */
const STEP_PART: Record<StepId, (g: Group) => unknown> = {
  sites: (g) => g.targets,
  when: (g) => g.policies.map((p) => [p.id, p.schedule, p.budget]),
  how: (g) => [g.policies.map((p) => [p.id, p.intervention]), g.pause],
  protection: (g) => g.protection,
  details: (g) => [g.name, g.note, g.color, g.icon, g.message, g.options],
  summary: () => null,
};

/** Problems with what happens; the other problems of a condition are with when it applies. */
const HOW_ISSUES = new Set([
  'validate.redirectUrl',
  'validate.phrase',
  'validate.askChoices',
  'validate.onlyTracking',
  'validate.pauseDuration',
]);
/**
 * Problems that a new rule shows next to their field instead (no sites yet, no name yet, an
 * address or a phrase being typed, a limit as long as its period).
 */
const SHOWN_IN_PLACE = new Set([
  'validate.noTargets',
  'validate.noName',
  'validate.redirectUrl',
  'validate.phrase',
  'validate.neverReached',
]);

/** The part where a problem found by validateGroup() is fixed. */
function stepOf(issue: Issue): StepId {
  if (HOW_ISSUES.has(issue.key)) return 'how';
  if (issue.policy !== undefined || issue.key === 'validate.noPolicies') return 'when';
  if (issue.key === 'validate.noName') return 'details';
  return 'sites';
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

/** What the editor remembers besides the rule, and what a new rule has yet to choose. */
interface Memory {
  /** Per condition: what it had before another answer to When was chosen. */
  memo: Record<string, ConditionMemo>;
  /** Per condition: what was set for each intervention tried. */
  kept: Record<string, KeptInterventions>;
  /** The conditions of a new rule whose "what happens" is not chosen yet (active choice). */
  pending: string[];
  /** A new rule takes the name, colour and icon of its ready-made lists until these are changed. */
  nameTouched: boolean;
  lookTouched: boolean;
}

/** A new rule in progress, kept for the session: leaving and coming back resumes it (NN/g). */
interface NewRuleDraft {
  group: Group;
  /**
   * #12: the rule's protection, chosen actively (nothing is pre-selected). A password or a
   * partner code is never kept in storage: a resumed rule asks for the protection again.
   */
  protection: Protection | null;
  step: number;
  /** The furthest part reached: the parts up to it can be opened from the progress bar. */
  reached: number;
  memory: Memory;
}

const PROTECTION_STEP = STEPS.indexOf('protection');

function load(store: string): NewRuleDraft | null {
  try {
    const raw = sessionStorage.getItem(store);
    const d = raw ? (JSON.parse(raw) as Partial<NewRuleDraft>) : null;
    // A rule started by an earlier version of the wizard is started again.
    if (!d?.group || !d.memory) return null;
    const protection = d.protection ?? null;
    // Without the protection (a password or a partner code was not kept), the parts after it would
    // show and create the default protection instead of the one chosen.
    const cap = (n = 0) => (protection ? n : Math.min(n, PROTECTION_STEP));
    return { group: d.group, protection, step: cap(d.step), reached: cap(d.reached), memory: d.memory };
  } catch {
    return null;
  }
}
function persist(store: string, d: NewRuleDraft | null) {
  try {
    if (d) sessionStorage.setItem(store, JSON.stringify({ ...d, protection: withoutSecret(d.protection) }));
    else sessionStorage.removeItem(store);
  } catch {
    // storage unavailable: the rule can still be created, it just does not resume
  }
}

/** A password or a partner code is not kept in session storage: it is chosen again. */
function withoutSecret(p: Protection | null): Protection | null {
  return p && (p.kind === 'password' || p.kind === 'partner') ? null : p;
}

/** Whether a rule was started in this session and not created or cancelled yet. */
export function hasRuleDraft(store: string): boolean {
  try {
    return sessionStorage.getItem(store) !== null;
  } catch {
    return false;
  }
}
/** Forgets the rule started in this session. */
export const discardRuleDraft = (store: string) => persist(store, null);

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

/** The name, colour and icon a new rule takes from its ready-made lists, until they are changed. */
function fromLists(targets: Target[], memory: Memory): Partial<Group> {
  const chosen = TEMPLATES.filter((x) => hasTemplate(targets, x.entries));
  return {
    ...(!memory.nameTouched ? { name: chosen.map((x) => t(x.nameKey)).join(' + ') } : {}),
    ...(!memory.lookTouched && chosen[0] ? { color: chosen[0].color, icon: chosen[0].icon } : {}),
  };
}

const emptyMemory = (): Memory => ({
  memo: {},
  kept: {},
  pending: [],
  nameTouched: false,
  lookTouched: false,
});

type Props =
  | {
      mode: 'edit';
      /** The rule being changed. */
      id: string;
      /** The part to open first (`?step=`), for links such as Protection's "Change". */
      step?: string | null;
    }
  | {
      mode: 'create';
      /** The session storage key of the draft. */
      store: string;
      /** A ready-made list to start from; a fresh draft is started. */
      template?: string | null;
      /** The top of the page: its heading and links. */
      head: ComponentChildren;
      /** A step shown as done before the rule's own (first run: "Installed"). */
      before?: string;
      class?: string;
      /** The first part's button goes back and keeps the draft (first run)… */
      onBack?: () => void;
      /** …or cancels: the draft is discarded. */
      onCancel?: () => void;
      /** Saves the new rule; resolves to true once it exists, and the draft is discarded. */
      create: (g: Group) => Promise<boolean>;
      /** More on the summary (first run: access to websites). */
      review?: ComponentChildren;
    };

export function RuleEditor(props: Props) {
  const { model } = useDashboard();
  const cfg = model.config;
  const creating = props.mode === 'create';
  const existing = props.mode === 'edit' ? (cfg.groups.find((g) => g.id === props.id) ?? null) : null;

  const fresh = (): NewRuleDraft => {
    const used = new Set(cfg.groups.map((g) => g.color));
    const policy = newPolicy({ intervention: frictionIntervention() });
    const memory: Memory = { ...emptyMemory(), pending: [policy.id] };
    let group = newGroup({
      color: GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[cfg.groups.length % GROUP_COLORS.length],
      policies: [policy],
      pause: defaultPause(),
    });
    const template = props.mode === 'create' ? props.template : null;
    if (template) {
      const targets = toggleTemplate(group.targets, template);
      group = { ...group, targets, ...fromLists(targets, memory) };
    }
    return { group, protection: null, step: 0, reached: 0, memory };
  };
  const [restored] = useState(() => (props.mode === 'create' && !props.template ? load(props.store) : null));
  const [start] = useState<NewRuleDraft>(() =>
    existing
      ? { group: existing, protection: existing.protection, step: 0, reached: 0, memory: emptyMemory() }
      : (restored ?? fresh()),
  );
  const [resumed, setResumed] = useState(Boolean(restored));
  const [draft, setDraft] = useState<Group>(() => clone(start.group));
  const [memory, setMemory] = useState<Memory>(start.memory);
  const [chosenProtection, setChosenProtection] = useState<Protection | null>(start.protection);
  const [step, setStep] = useState<StepId>(() => {
    if (creating) return STEPS[start.step] ?? 'sites';
    const asked = props.mode === 'edit' ? (props.step ?? '') : '';
    return STEPS.includes(asked as StepId) ? (asked as StepId) : (OLD_STEPS[asked] ?? 'summary');
  });
  const [reached, setReached] = useState(start.reached);
  const index = STEPS.indexOf(step);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(creating);
  const flow = useSaveFlow();

  // The rule as last saved (edit): the draft is "dirty" only when the person changed it, not when
  // the rule changed in the background.
  const [synced, setSynced] = useState<string>(() => JSON.stringify(start.group));
  const saved = useMemo(() => JSON.parse(synced) as Group, [synced]);
  const dirty = !creating && JSON.stringify(draft) !== synced;
  const adopt = (g: Group) => {
    setDraft(clone(g));
    setSynced(JSON.stringify(g));
  };
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A new rule is kept for the session.
  useEffect(() => {
    if (props.mode === 'create')
      persist(props.store, { group: draft, protection: chosenProtection, step: index, reached, memory });
  }, [draft, memory, chosenProtection, index, reached]);
  // Follow background changes (popup, context menu, another tab) when nothing is being edited.
  useEffect(() => {
    if (existing && !dirty) adopt(existing);
  }, [existing]);
  useEffect(() => {
    if (creating) return;
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
  // Focus follows the part; opening a rule that exists leaves it in place.
  useEffect(() => {
    if (!moved.current) return;
    if (!creating) window.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: !creating });
  }, [step]);
  const go = (s: StepId) => {
    moved.current = true;
    setStep(s);
    setReached((r) => Math.max(r, STEPS.indexOf(s)));
  };

  // A new rule's protection is chosen in its part; the draft holds a placeholder until then.
  const protection = creating ? chosenProtection : draft.protection;
  const build = (): Group => {
    const g: Group = {
      ...draft,
      name: draft.name.trim(),
      note: draft.note.trim(),
      policies: withCountingGap(draft.policies),
      protection: chosenProtection ?? DEFAULT_PROTECTION,
      updatedAt: Date.now(),
    };
    // A break lifts a block only: a rule that does something else has none (#15).
    return canHaveBreaks(g) ? g : { ...g, pause: { ...g.pause, allowed: false } };
  };
  const rule = creating ? build() : draft;

  const issues = validateGroup(draft);
  const errors = issues.filter((i) => i.level === 'error').length;
  const issuesOf = (s: StepId) => issues.filter((i) => stepOf(i) === s);
  const stepIssues =
    step === 'summary'
      ? issues
      : issuesOf(step).filter((i) => !creating || i.level !== 'error' || !SHOWN_IN_PLACE.has(i.key));
  const changed = (s: StepId) => JSON.stringify(STEP_PART[s](draft)) !== JSON.stringify(STEP_PART[s](saved));

  const set = (patch: Partial<Group>) => setDraft((d) => ({ ...d, ...patch }));
  const remember = (patch: Partial<Memory>) => setMemory((m) => ({ ...m, ...patch }));
  const setPolicy = (i: number, p: Policy) =>
    setDraft((d) => ({ ...d, policies: d.policies.map((x, j) => (j === i ? p : x)) }));
  const movePolicy = (i: number, dir: -1 | 1) => {
    const list = [...draft.policies];
    const [p] = list.splice(i, 1);
    list.splice(i + dir, 0, p);
    set({ policies: list });
  };
  // A condition added opens, ready to be set.
  const [added, setAdded] = useState<string | null>(null);
  const addPolicy = (p: Policy) => {
    setAdded(p.id);
    set({ policies: [...draft.policies, p] });
  };
  const choose = (i: number, p: Policy, intervention: Intervention, kept: KeptInterventions) => {
    setPolicy(i, { ...p, intervention });
    remember({ kept: { ...memory.kept, [p.id]: kept }, pending: memory.pending.filter((x) => x !== p.id) });
  };
  const toggleList = (id: string) => {
    const targets = toggleTemplate(draft.targets, id);
    set({ targets, ...(creating ? fromLists(targets, memory) : {}) });
  };

  const sites = draft.targets.filter((x) => !x.allow);
  const severalSites = sites.length > 1;
  const pendingNow = memory.pending.filter((id) => draft.policies.some((p) => p.id === id));
  const blocked = (s: StepId) =>
    issuesOf(s).some((i) => i.level === 'error') ||
    (s === 'how' && pendingNow.length > 0) ||
    (s === 'protection' && !protection);
  const ready = STEPS.every((s) => !blocked(s));

  // ---------------------------------------------------------------- saving
  const [busy, setBusy] = useState(false);
  const createRule = async () => {
    if (props.mode !== 'create' || busy) return;
    // A second click while saving would create the rule twice.
    setBusy(true);
    try {
      if (await props.create(build())) persist(props.store, null);
    } finally {
      setBusy(false);
    }
  };
  const first = () => {
    if (props.mode !== 'create') return;
    if (props.onBack) return props.onBack();
    persist(props.store, null);
    props.onCancel?.();
  };
  const save = async () => {
    if (hasErrors(issues)) {
      toast(t('editor.fixErrors'));
      const firstIssue = issues.find((i) => i.level === 'error');
      if (firstIssue && stepOf(firstIssue) !== step) go(stepOf(firstIssue));
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
      const now = (await call('config.get', {})).config.groups.find((g) => g.id === draft.id);
      if (now) adopt(now);
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
    if (await flow.run(call('config.save', { config: next }))) {
      setNavigationGuard(null);
      navigate('/groups');
    }
  };

  // ---------------------------------------------------------------- the parts
  const single = draft.policies.length === 1;
  const addConditions = <AddConditions onAdd={addPolicy} first={single} />;
  const memoOf = (p: Policy) => memory.memo[p.id] ?? {};
  const setMemo = (p: Policy, m: ConditionMemo) => remember({ memo: { ...memory.memo, [p.id]: m } });
  const picker = (p: Policy, i: number) => (
    <InterventionPicker
      value={pendingNow.includes(p.id) ? null : p.intervention}
      kept={memory.kept[p.id]}
      dontCount={!single}
      onChange={(iv, kept) => choose(i, p, iv, kept)}
    />
  );

  const parts: Record<StepId, () => ComponentChildren> = {
    sites: () => (
      <>
        <div class="field">
          <span class="label" id="rule-templates">
            {t('wizard.sites.templates')}
          </span>
          <span class="help">{t('editor.templatesHelp')}</span>
          <div class="chips" role="group" aria-labelledby="rule-templates">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                class="chip"
                aria-pressed={hasTemplate(draft.targets, tpl.entries)}
                onClick={() => toggleList(tpl.id)}
              >
                <Icon name={tpl.icon} />
                {t(tpl.nameKey)}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <span class="label">{t('wizard.sites.yours')}</span>
          <TargetsEditor targets={draft.targets} onChange={(targets) => set({ targets })} />
          {creating && !sites.length && <span class="help">{t('wizard.sites.none')}</span>}
        </div>
      </>
    ),

    when: () =>
      single ? (
        <ConditionEditor
          policy={draft.policies[0]}
          onChange={(p) => setPolicy(0, p)}
          severalSites={severalSites}
          memo={memoOf(draft.policies[0])}
          onMemo={(m) => setMemo(draft.policies[0], m)}
          more={addConditions}
        />
      ) : (
        <div class="stack stack-sm">
          {draft.policies.map((p, i) => (
            <PolicyCard
              key={p.id}
              policy={p}
              index={i}
              count={draft.policies.length}
              open={p.id === added}
              onMove={(dir) => movePolicy(i, dir)}
              onRemove={() => set({ policies: draft.policies.filter((_, j) => j !== i) })}
            >
              <ConditionEditor
                policy={p}
                onChange={(np) => setPolicy(i, np)}
                severalSites={severalSites}
                memo={memoOf(p)}
                onMemo={(m) => setMemo(p, m)}
              />
            </PolicyCard>
          ))}
          <Otherwise policies={draft.policies} />
          {addConditions}
        </div>
      ),

    how: () => (
      <div class="stack">
        {single ? (
          picker(draft.policies[0], 0)
        ) : draft.policies.length ? (
          <div class="stack stack-sm">
            {draft.policies.map((p, i) => (
              <PolicyCard key={p.id} policy={p} index={i} count={draft.policies.length} open={p.id === added}>
                {picker(p, i)}
              </PolicyCard>
            ))}
            <Otherwise policies={draft.policies} />
          </div>
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
          <section class="stack editor-breaks" aria-labelledby="rule-breaks-title">
            <h3 id="rule-breaks-title">{t('editor.breaks')}</h3>
            <PauseEditor
              value={draft.pause}
              onChange={(pause) => set({ pause })}
              hasPassword={protection?.kind === 'password'}
            />
          </section>
        )}
      </div>
    ),

    protection: () => (
      <ProtectionPicker
        key={synced}
        value={protection}
        onChange={(p) => (creating ? setChosenProtection(p) : set({ protection: p }))}
        groupId={draft.id}
        name={draft.name}
        label={t('editor.level')}
        breaks={canHaveBreaks(draft) && draft.pause.allowed}
      />
    ),

    details: () => (
      <>
        <div class="field">
          <label class="label" for="rule-name">
            {t('editor.name')}
          </label>
          <input
            id="rule-name"
            class="input"
            value={draft.name}
            maxLength={80}
            placeholder={t('editor.namePlaceholder')}
            aria-describedby={creating && !draft.name.trim() ? 'rule-name-help' : undefined}
            onInput={(e) => {
              set({ name: (e.target as HTMLInputElement).value });
              if (creating) remember({ nameTouched: true });
            }}
          />
          {creating && !draft.name.trim() && (
            <span class="help" id="rule-name-help">
              {t('validate.noName')}
            </span>
          )}
        </div>
        <div class="field">
          <label class="label" for="rule-note">
            {t('editor.note')}
          </label>
          <textarea
            id="rule-note"
            aria-describedby="rule-note-help"
            class="textarea"
            rows={2}
            maxLength={500}
            value={draft.note}
            placeholder={t('editor.notePlaceholder')}
            onInput={(e) => set({ note: (e.target as HTMLTextAreaElement).value })}
          />
          <span class="help" id="rule-note-help">
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
              onChange={(color) => {
                set({ color });
                remember({ lookTouched: true });
              }}
              label={t('editor.color')}
              class="picker"
              itemClass="swatch"
              options={GROUP_COLORS.map((c) => ({ value: c }))}
              render={(o) => (
                <>
                  <span style={{ background: o.value }} aria-hidden="true" />
                  <span class="sr-only">{t('editor.colorN', { n: GROUP_COLORS.indexOf(o.value) + 1 })}</span>
                </>
              )}
            />
            <RadioCards
              value={draft.icon}
              onChange={(icon) => {
                set({ icon });
                remember({ lookTouched: true });
              }}
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
        <AdvancedOptions open={optionsAdvanced(draft.options)}>
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
                onChange={(tabs) => set({ options: { ...draft.options, tabs } })}
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
        </AdvancedOptions>
      </>
    ),

    summary: () => (
      <>
        <Summary rule={rule} issues={issues} onChange={go} />
        {props.mode === 'create' && props.review}
      </>
    ),
  };

  // ---------------------------------------------------------------- the page
  const groupState = model.groups[draft.id];
  const nextStep: StepId | null = STEPS[index + 1] ?? null;
  const title =
    step === 'summary' ? t(creating ? 'wizard.review.title' : 'editor.overview.title') : t(STEP_TITLE[step]);
  const intro =
    step === 'summary'
      ? t(creating ? 'wizard.review.intro' : 'editor.overview.intro')
      : !single && step === 'when'
        ? t('editor.when.intro')
        : !single && step === 'how'
          ? t('editor.how.intro')
          : t(STEP_INTRO[step]);

  return (
    <div
      class={`stack stack-lg wizard-page${creating ? '' : ' editor-page'} ${props.mode === 'create' ? (props.class ?? '') : ''}`}
    >
      <div class="page-head">
        {props.mode === 'create' ? (
          props.head
        ) : (
          <>
            <div style={{ minWidth: 0 }}>
              <a href="#/groups" class="back quiet">
                <Icon name="chevron-left" />
                {t('nav.groups')}
              </a>
              <div class="editor-title">
                <GroupTile color={draft.color} icon={draft.icon} size={40} />
                <h1 class="ellipsis">{draft.name.trim() || t('editor.unnamed')}</h1>
              </div>
            </div>
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
          </>
        )}
      </div>

      <nav aria-label={t(creating ? 'wizard.steps' : 'editor.sections')}>
        <ol class={`wizard-progress${creating ? '' : ' editor-steps'}`}>
          {props.mode === 'create' && props.before && (
            <li class="done">
              <span>
                <span class="num" aria-hidden="true">
                  <Icon name="check" />
                </span>
                <span class="label">{props.before}</span>
              </span>
            </li>
          )}
          {STEPS.map((id, i) => {
            const current = id === step;
            const label = <span class="label">{t(STEP_LABEL[id])}</span>;
            if (creating) {
              // A new rule: the parts reached can be opened again, the others come in order.
              const done = !current && i <= reached;
              const num = (
                <span class="num" aria-hidden="true">
                  {done ? <Icon name="check" /> : i + 1}
                </span>
              );
              return (
                <li key={id} class={current ? 'current' : done ? 'done' : ''}>
                  {done ? (
                    <button type="button" onClick={() => go(id)}>
                      {num}
                      {label}
                      <span class="sr-only"> — {t('wizard.done')}</span>
                    </button>
                  ) : (
                    <span aria-current={current ? 'step' : undefined}>
                      {num}
                      {label}
                    </span>
                  )}
                </li>
              );
            }
            const bad = issues.some((x) => x.level === 'error' && stepOf(x) === id) && id !== 'summary';
            const edited = changed(id);
            return (
              <li key={id} class={current ? 'current' : ''}>
                <button type="button" aria-current={current ? 'step' : undefined} onClick={() => go(id)}>
                  <span class="num" aria-hidden="true">
                    <Icon name={STEP_ICON[id]} />
                  </span>
                  {label}
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

      {resumed && step === STEPS[restored?.step ?? 0] && (
        <Banner
          kind="info"
          icon="refresh"
          action={
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                const d = fresh();
                setResumed(false);
                setDraft(d.group);
                setMemory(d.memory);
                setChosenProtection(null);
                setReached(0);
                go('sites');
              }}
            >
              {t('wizard.startOver')}
            </Button>
          }
        >
          {t('wizard.resumed')}
        </Banner>
      )}
      {groupState?.lockedNow && (
        <Banner kind="info" icon="lock">
          {t('editor.lockedNow')}
        </Banner>
      )}

      <section class="card stack stack-lg" aria-labelledby="rule-step-title">
        <div>
          <p class="overline">
            {t(creating ? 'wizard.stepOf' : 'editor.partOf', { n: index + 1, total: STEPS.length })}
          </p>
          <h2 id="rule-step-title" ref={titleRef} tabIndex={-1}>
            {title}
          </h2>
          <p class="card-sub">{intro}</p>
        </div>
        {step !== 'summary' && stepIssues.length > 0 && <IssueList issues={stepIssues} />}
        {parts[step]()}
        {!creating && nextStep && (
          <div class="row end">
            <button type="button" class="link-btn small row nowrap" onClick={() => go(nextStep)}>
              {t(NEXT_LABEL[nextStep as Exclude<StepId, 'sites'>])}
              <Icon name="chevron-right" />
            </button>
          </div>
        )}
      </section>

      {!creating && step === 'summary' && (
        <section class="card stack stack-sm" aria-labelledby="rule-test-title">
          <h3 id="rule-test-title">{t('test.title')}</h3>
          <TestUrl draft={draft} groups={cfg.groups} />
        </section>
      )}

      {creating ? (
        // Back sits next to Next; Cancel (first part, from Rules) at the other end.
        <div class="sticky-actions row between">
          {!index && props.mode === 'create' && !props.onBack && (
            <Button variant="ghost" onClick={first}>
              {t('common.cancel')}
            </Button>
          )}
          <div class="row wizard-nav">
            {(index > 0 || (props.mode === 'create' && props.onBack)) && (
              <Button icon="chevron-left" onClick={() => (index ? go(STEPS[index - 1]) : first())}>
                {t('wizard.back')}
              </Button>
            )}
            {nextStep ? (
              <Button variant="primary" disabled={blocked(step)} onClick={() => go(nextStep)}>
                {t(NEXT_LABEL[nextStep as Exclude<StepId, 'sites'>])}
                <Icon name="chevron-right" />
              </Button>
            ) : (
              <Button variant="primary" icon="check" disabled={!ready || busy} onClick={createRule}>
                {t('wizard.create')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div class="sticky-actions row between">
          <Button variant="ghost" onClick={() => (dirty ? adopt(existing ?? saved) : navigate('/groups'))}>
            {dirty ? t('editor.discard') : t('common.close')}
          </Button>
          <div class="row">
            {dirty && <span class="unsaved">{t('editor.unsaved')}</span>}
            {errors > 0 && <span class="error-text">{t('editor.errorsCount', { count: errors })}</span>}
            <Button variant="primary" icon="check" onClick={save} disabled={saving || !dirty}>
              {t('editor.save')}
            </Button>
          </div>
        </div>
      )}
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

/**
 * More conditions for a rule. Adding the second one says how they work together: each says when
 * the rule acts, and the first that matches applies.
 */
function AddConditions({ onAdd, first }: { onAdd: (p: Policy) => void; first: boolean }) {
  return (
    <div class="stack stack-sm">
      {first && (
        <>
          <h4>{t('editor.moreConditions')}</h4>
          <p class="help">{t('editor.when.intro')}</p>
        </>
      )}
      <div class="add-rule">
        <span class="small text-2 strong">{t('editor.addRule')}</span>
        <Button
          size="small"
          icon="calendar"
          onClick={() =>
            onAdd(
              newPolicy({
                schedule: { mode: 'during', windows: [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }] },
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
            onAdd(
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
          onClick={() => onAdd(newPolicy({ intervention: frictionIntervention() }))}
        >
          {t('editor.addAlways')}
        </Button>
      </div>
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

/**
 * The summary: what the rule does as a plan, then each part with its "Change" link (the "check
 * your answers" pattern), and what to check before creating or saving.
 */
function Summary({
  rule,
  issues,
  onChange,
}: {
  rule: Group;
  issues: Issue[];
  onChange: (s: StepId) => void;
}) {
  const sites = rule.targets.filter((x) => !x.allow);
  const exceptions = rule.targets.length - sites.length;
  const plan = rulePlan(rule);
  const row = (id: StepId, value: ComponentChildren) => (
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
      <div class={`plan tone-${ruleTone(rule)}`}>
        <GroupTile color={rule.color} icon={rule.icon} size={48} />
        <div class="stack stack-sm" style={{ minWidth: 0 }}>
          <div class="row">
            <strong class="plan-name">{rule.name.trim() || t('editor.unnamed')}</strong>
            {!rule.enabled && (
              <StatusPill small tone="neutral" icon="pause">
                {t('groups.disabled')}
              </StatusPill>
            )}
          </div>
          {plan ? (
            <p class="plan-text">{plan}</p>
          ) : (
            <>
              <p class="small text-2">
                {sites.length
                  ? t('editor.overview.on', { sites: sitesPhrase(rule.targets) })
                  : t('editor.overview.noSites')}
              </p>
              <Conditions g={rule} />
            </>
          )}
          {rule.note.trim() && <p class="small quote">“{rule.note.trim()}”</p>}
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
        {/* A plan in a sentence has one condition (counting at certain times also leaves the
            other times alone). */}
        {row(
          'when',
          plan || rule.policies.length === 1
            ? describeCondition(rule.policies[0])
            : t('editor.overview.conditions', { count: rule.policies.length }),
        )}
        {row(
          'how',
          <span class="stack stack-xs">
            <span>
              {plan
                ? describeIntervention(rule.policies[0].intervention)
                : rule.policies.length
                  ? [...new Set(rule.policies.map((x) => describeIntervention(x.intervention)))].join(' · ')
                  : t('editor.overview.openNormally')}
            </span>
            {canHaveBreaks(rule) && <span>{pauseRulesSummary(rule.pause)}</span>}
          </span>,
        )}
        {row(
          'details',
          <>
            {rule.message.trim() ? t('editor.overview.message') : t('editor.overview.noMessage')}
            {!rule.note.trim() && ` · ${t('editor.overview.noReason')}`}
          </>,
        )}
        {row(
          'protection',
          <span class="row nowrap">
            <Icon name={protectionIcon(rule.protection.kind)} />
            {protectionLabel(rule.protection)}
          </span>,
        )}
      </dl>
    </>
  );
}
