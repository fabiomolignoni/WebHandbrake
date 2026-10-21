/** Names and icons of the protections of rules, for every page. */

import type { Protection, ProtectionKind } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatDateTime, formatDuration } from '../shared/format';

export function protectionIcon(kind: ProtectionKind): string {
  return {
    reminder: 'leaf',
    wait: 'hourglass',
    password: 'key',
    partner: 'users',
    locked: 'lock',
    permanent: 'infinity',
  }[kind];
}

/** "Reminder", "Wait · 1 h", "Locked until Fri 12 Oct 00:00"… */
export function protectionLabel(p: Protection): string {
  if (p.kind === 'wait') return t('level.wait.tag', { duration: formatDuration(p.seconds) });
  if (p.kind === 'locked') return t('level.locked.tag', { when: formatDateTime(p.until) });
  return t(`level.${p.kind}`);
}
