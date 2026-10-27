/** "Why?": which groups, entries and policies apply, and when it changes. */

import { isNav } from '../engine/severity';
import type { Group } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatDuration, whenParams } from '../shared/format';
import type { BudgetView, DecisionView, GroupDecisionView } from '../shared/models';
import {
  describeCondition,
  describeIntervention,
  describeTarget,
  interventionName,
  targetTypeLabel,
} from '../shared/summary';
import { ColorDot } from './components';
import { Icon } from './icons';
import { statusName, thenName } from './status';

export function budgetText(b: BudgetView): string {
  if (b.type === 'visits') return t('budget.visitsUsed', { used: b.used, limit: b.limit });
  return t('budget.timeUsed', { used: formatDuration(b.used), limit: formatDuration(b.limit) });
}

export function verdict(d: DecisionView, now = Date.now()): string {
  if (d.exempt) return t('why.exempt');
  // A restricted page says its state, as the popup does ("Blocked until 17:00").
  const name = statusName(d.intervention);
  if (isNav(d)) {
    return d.until
      ? t('why.restrictedUntil', { what: name, ...whenParams(d.until, now) })
      : t('why.restricted', { what: name });
  }
  if (!d.groups.length) return d.excepted.length ? t('why.excepted') : t('why.noRules');
  if (d.groups.some((g) => g.pause)) return t('why.paused');
  if (d.groups.some((g) => g.pass)) return t('why.passed');
  if (d.restriction) return t('why.allowedUntil', whenParams(d.restriction.at, now));
  return t('why.allowed');
}

function GroupBlock({ g, groups }: { g: GroupDecisionView; groups?: Group[] }) {
  const group = groups?.find((x) => x.id === g.groupId);
  return (
    <div class="stack stack-sm card flat tight">
      <div class="row">
        <ColorDot color={g.color} />
        <strong>{g.name}</strong>
        <span class="tag">{interventionName(g.intervention.type)}</span>
      </div>
      <p class="small">
        {t('why.matchedBy', { type: targetTypeLabel(g.entry.type), value: describeTarget(g.entry) })}
      </p>
      {g.source === 'session' && <p class="small">{t('why.bySession')}</p>}
      {g.pause && (
        <p class="small">{g.pause.until ? t('why.pause', whenParams(g.pause.until)) : t('why.paused')}</p>
      )}
      {g.pass && (
        <p class="small">
          {g.pass.until ? t('why.passUntil', whenParams(g.pass.until)) : t('why.passVisit')}
          {g.pass.intention ? ` — ${t('common.quote', { text: g.pass.intention })}` : ''}
        </p>
      )}
      {g.policies.length > 0 && (
        <ol class="list compact small" aria-label={t('why.policies')}>
          {g.policies.map((p) => {
            const policy = group?.policies.find((x) => x.id === p.id);
            return (
              <li key={p.id} class="row nowrap top">
                <Icon
                  name={p.index === g.policyIndex ? 'check' : 'x'}
                  label={p.index === g.policyIndex ? t('why.applies') : t('why.notNow')}
                />
                <span class="grow">
                  {policy ? describeCondition(policy) : `#${p.index + 1}`} →{' '}
                  {describeIntervention(p.intervention)}
                  {p.budget && <span class="muted"> · {budgetText(p.budget)}</span>}
                  {p.index === g.policyIndex && <strong> · {t('why.applies')}</strong>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function Explain({ d, groups }: { d: DecisionView; groups?: Group[] }) {
  return (
    <div class="stack stack-sm why">
      <p>
        <strong>{verdict(d)}</strong>
      </p>
      {d.session && <p class="small">{t('why.session', whenParams(d.session.endAt))}</p>}
      {d.groups.map((g) => (
        <GroupBlock key={g.groupId} g={g} groups={groups} />
      ))}
      {d.excepted.map((e) => (
        <p key={e.groupId} class="small">
          {t('why.exceptionIn', { group: e.name, value: describeTarget(e.entry) })}
        </p>
      ))}
      {d.until && (
        <p class="small">
          {t('why.nextChange', { what: d.next ? thenName(d.next) : '', ...whenParams(d.until) })}
        </p>
      )}
      {!d.until && isNav(d) && <p class="small">{t('why.noEnd')}</p>}
      {d.restriction && !isNav(d) && (
        <p class="small">
          {t(`why.restriction.${d.restriction.kind}`, {
            what: thenName(d.restriction.intervention),
            ...whenParams(d.restriction.at),
          })}
        </p>
      )}
    </div>
  );
}
