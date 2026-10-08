/**
 * The plan of a new rule as one if-then sentence ("When you open …, WebHandbrake …"), shared by
 * the rule wizard and onboarding (docs/design.md: implementation intentions).
 */

import { isSensitiveSite } from '../data/templates';
import { QUICK_DELAY_SECONDS, type QuickHow, type QuickWhen } from '../engine/defaults';
import type { Target, TimeWindow } from '../engine/types';
import { locale, t } from '../i18n/i18n';
import { formatDuration } from '../shared/format';
import { describeWindows } from '../shared/summary';

/** "a.com, b.com and 3 more sites"; addresses from the sensitive lists are only counted. */
export function sitesPhrase(targets: Target[]): string {
  const values = targets.filter((x) => !x.allow).map((x) => x.value);
  const first = values.filter((x) => !isSensitiveSite(x)).slice(0, 2);
  if (!first.length) return t('groups.sites', { count: values.length });
  return t('wizard.sitesList', { first: first.join(', '), count: values.length - first.length });
}

/** "Social media, Video and News", in the language of the interface. */
export function namesPhrase(names: string[]): string {
  try {
    return new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

export function planSentence(
  when: QuickWhen,
  how: QuickHow,
  sites: string,
  windows: TimeWindow[],
  minutes: number,
  redirectUrl = '',
): string {
  return t('wizard.review.plan', {
    cond: t(`wizard.cond.${when}`, {
      sites,
      windows: describeWindows(windows),
      duration: formatDuration(minutes * 60),
    }),
    outcome: t(`wizard.then.${how}`, { seconds: QUICK_DELAY_SECONDS, url: redirectUrl.trim() }),
  });
}
