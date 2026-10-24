/**
 * The plan of a rule as one if-then sentence ("When you open …, WebHandbrake …"), shown at the top
 * of the rule editor's summary (implementation intentions).
 */

import { ASK_WAIT_SECONDS, DAY_MINUTES, everyPeriod, periodMinutes } from '../engine/defaults';
import { ALL_SITES } from '../engine/patterns';
import type { Group, Intervention, Target, TimeWindow } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatDuration } from '../shared/format';
import { describePeriod, describeWindows } from '../shared/summary';
import { whenKind } from './rule-form';

/** When the condition of a rule applies, as When asks. */
type PlanWhen = 'always' | 'schedule' | 'daily' | 'visits';

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
  /** The minutes allowed (after some time) or the visits (after some visits). */
  amount: number,
  every = DAY_MINUTES,
  /** Whether a limit is for one site, shared by several or for each of them. */
  limitSites: 'one' | 'shared' | 'each' = 'one',
): string {
  const outcome = outcomeOf(when, intervention);
  const limit = when === 'daily' || when === 'visits';
  const cond = limit && limitSites !== 'one' ? `${when}.${limitSites}` : when;
  return t('wizard.review.plan', {
    cond: t(`wizard.cond.${cond}`, {
      sites,
      windows: describeWindows(windows),
      duration: formatDuration(amount * 60),
      count: amount,
      period: periodPhrase(every),
    }),
    outcome,
  });
}

/** The plan of a rule as a sentence: its condition, then what happens. */
export function rulePlan(g: Group): string {
  const [p] = g.policies;
  const i = p.intervention;
  const sites = sitesPhrase(g.targets);
  const b = p.budget;
  if (!b)
    return planSentence(whenKind(p) === 'schedule' ? 'schedule' : 'always', i, sites, p.schedule.windows, 0);
  const several = g.targets.filter((x) => !x.allow).length > 1;
  return planSentence(
    b.type === 'visits' ? 'visits' : 'daily',
    i,
    sites,
    [],
    b.type === 'visits' ? b.count : b.minutes,
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
