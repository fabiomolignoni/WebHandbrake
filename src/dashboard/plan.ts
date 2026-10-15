/**
 * The plan of a new rule as one if-then sentence ("When you open …, WebHandbrake …"), shared by
 * the rule wizard and onboarding (implementation intentions).
 */

import { type QuickHow, type QuickWhen, quickIntervention } from '../engine/defaults';
import { ALL_SITES } from '../engine/patterns';
import type { Intervention, Target, TimeWindow } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatDuration } from '../shared/format';
import { describeWindows } from '../shared/summary';

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

/** What happens, with the settings chosen in the wizard (#14). */
function outcomeOf(when: QuickWhen, i: Intervention): string {
  switch (i.type) {
    // Counting at certain times leaves the other times alone (#21): the plan says so.
    case 'track':
      return when === 'schedule' ? t('wizard.then.trackSchedule') : t('wizard.then.track');
    case 'filter':
      return t('wizard.then.filter', { filter: t(`filter.${i.filter}`) });
    case 'ask':
      return t('wizard.then.ask', { max: formatDuration(i.maxMinutes * 60) });
    case 'delay':
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
  when: QuickWhen,
  how: QuickHow | Intervention,
  sites: string,
  windows: TimeWindow[],
  minutes: number,
  redirectUrl = '',
): string {
  const outcome = outcomeOf(when, typeof how === 'string' ? quickIntervention(how, redirectUrl) : how);
  return t('wizard.review.plan', {
    cond: t(`wizard.cond.${when}`, {
      sites,
      windows: describeWindows(windows),
      duration: formatDuration(minutes * 60),
    }),
    outcome,
  });
}
