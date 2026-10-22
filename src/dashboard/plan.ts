/**
 * The plan of a rule as one if-then sentence ("When you open …, WebHandbrake …"), shown at the top
 * of the rule editor's summary (implementation intentions).
 */

import { ASK_WAIT_SECONDS, DAY_MINUTES, everyPeriod, periodMinutes } from '../engine/defaults';
import { ALL_SITES } from '../engine/patterns';
import type { Group, Intervention, Policy, Target, TimeWindow } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatDuration } from '../shared/format';
import { describePeriod, describeWindows } from '../shared/summary';
import { everyKind, whenKind } from './rule-form';

/** When the condition of a rule applies, as the first question of the rule editor asks. */
type PlanWhen = 'always' | 'schedule' | 'daily';

/** "a.com, b.com and 3 more sites". */
export function sitesPhrase(targets: Target[]): string {
  const blocks = targets.filter((x) => !x.allow);
  // Inside a sentence: "Every time you open any website".
  if (blocks.some((x) => x.type === 'wildcard' && x.value === ALL_SITES)) return t('wizard.sitesAll');
  const values = blocks.map((x) => x.value);
  const first = values.slice(0, 2);
  if (!first.length) return t('groups.sites', { count: values.length });
  return t('wizard.sitesList', { first: first.join(', '), count: values.length - first.length });
}

/** What happens, with its main settings. */
function outcomeOf(when: PlanWhen, i: Intervention): string {
  switch (i.type) {
    // Counting at certain times leaves the other times alone (#21): the plan says so.
    case 'track':
      return when === 'schedule' ? t('wizard.then.trackSchedule') : t('wizard.then.track');
    case 'filter':
      return t('wizard.then.filter', { filter: t(`filter.${i.filter}`) });
    case 'ask':
      // The wait on the page is part of the deal: the plan says so.
      return t('wizard.then.ask', { max: formatDuration(i.maxMinutes * 60), seconds: ASK_WAIT_SECONDS });
    case 'delay':
      if (i.randomTo) return t('wizard.then.delayRandom', { from: i.seconds, to: i.randomTo });
      if (i.increase) return t('wizard.then.delayGrowing', { seconds: i.seconds, increase: i.increase });
      return t('wizard.then.delay', { seconds: i.seconds });
    case 'challenge':
      if (i.kind === 'phrase') return t('wizard.then.challengePhrase');
      if (i.kind === 'math') return t('wizard.then.challengeMath');
      return t('wizard.then.challenge', { length: i.length ?? 24 });
    case 'redirect':
      return t('wizard.then.redirect', { url: i.url.trim() });
    case 'close':
      return t('wizard.then.close');
    default:
      return t('wizard.then.block');
  }
}

export function planSentence(
  when: PlanWhen,
  intervention: Intervention,
  sites: string,
  windows: TimeWindow[],
  minutes: number,
  every = DAY_MINUTES,
  /** Whether a time limit is for one site, shared by several or for each of them. */
  limitSites: 'one' | 'shared' | 'each' = 'one',
): string {
  const outcome = outcomeOf(when, intervention);
  const cond = when === 'daily' && limitSites !== 'one' ? `daily.${limitSites}` : when;
  return t('wizard.review.plan', {
    cond: t(`wizard.cond.${cond}`, {
      sites,
      windows: describeWindows(windows),
      duration: formatDuration(minutes * 60),
      period: periodPhrase(every),
    }),
    outcome,
  });
}

/** The last condition of a rule that counts at certain times: at other times, nothing. */
const leavesAlone = (p: Policy) =>
  p.intervention.type === 'allow' && p.schedule.mode === 'always' && !p.budget;

/**
 * The plan of a rule as a sentence, when its condition is one that the first questions describe:
 * every time, during certain times, or after some time that starts again every so often. Null for
 * any other rule, whose conditions are listed instead.
 */
export function rulePlan(g: Group): string | null {
  let policies = g.policies;
  const counting = policies[0]?.intervention.type === 'track' && policies[0].schedule.mode === 'during';
  // Counting at certain times, and nothing at the others (#21).
  if (policies.length === 2 && counting && !policies[0].budget && leavesAlone(policies[1]))
    policies = [policies[0]];
  else if (counting) return null;
  if (policies.length !== 1) return null;
  const [p] = policies;
  const i = p.intervention;
  if (i.type === 'allow') return null;
  const sites = sitesPhrase(g.targets);
  const kind = whenKind(p);
  if (kind === 'always') return planSentence('always', i, sites, [], 0);
  if (kind === 'schedule')
    return p.schedule.mode === 'during' ? planSentence('schedule', i, sites, p.schedule.windows, 0) : null;
  const b = p.budget;
  if (b?.type !== 'time' || p.schedule.mode !== 'always' || !everyKind(b.period) || b.period.offset)
    return null;
  const several = g.targets.filter((x) => !x.allow).length > 1;
  return planSentence(
    'daily',
    i,
    sites,
    [],
    b.minutes,
    periodMinutes(b.period),
    several ? (b.perSite ? 'each' : 'shared') : 'one',
  );
}

/** "a day", "an hour", "every 3 days": how often the time allowed starts again. */
function periodPhrase(every: number): string {
  const period = everyPeriod(every);
  if (period.kind === 'day') return t('wizard.period.day');
  if (period.kind === 'hour') return t('wizard.period.hour');
  return describePeriod(period);
}
