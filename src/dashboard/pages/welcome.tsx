/**
 * First run (ONB-01, ONB-02, US-01): goal → sites → when → style → protection → permissions →
 * summary, in about two minutes, skippable and re-runnable from Help.
 */

import { useEffect, useState } from 'preact/hooks';
import { TEMPLATES } from '../../data/templates';
import {
  GROUP_COLORS,
  newGroup,
  pausePolicyFor,
  quickPolicies,
  SCHEDULE_PRESETS,
  targetsFromSites,
} from '../../engine/defaults';
import type { Group, Policy, ProtectionLevel, Target, TimeWindow } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { api, browserName } from '../../platform/api';
import { call } from '../../shared/rpc';
import { summarizeGroup } from '../../shared/summary';
import { Banner, Button, Chips, toast } from '../../ui/components';
import { BrakeLogo, Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { WindowsEditor } from '../components/schedule';
import { TargetsEditor } from '../components/targets';
import { clone, useDashboard } from '../context';
import { navigate } from '../router';
import { LevelExplanation, levelIcon } from './group-editor';

type Goal = 'schedule' | 'limit' | 'friction' | 'block' | 'track';
type Style = 'ask' | 'delay' | 'block';

const GOALS: { id: Goal; icon: string }[] = [
  { id: 'schedule', icon: 'calendar' },
  { id: 'limit', icon: 'hourglass' },
  { id: 'friction', icon: 'wind' },
  { id: 'block', icon: 'ban' },
  { id: 'track', icon: 'chart' },
];

function policiesFor(goal: Goal, style: Style, windows: TimeWindow[], minutes: number): Policy[] {
  switch (goal) {
    case 'schedule':
      return quickPolicies('schedule', style, windows, minutes);
    case 'limit':
      return quickPolicies('daily', style, windows, minutes);
    case 'friction':
      return quickPolicies('always', style, windows, minutes);
    case 'block':
      return quickPolicies('always', 'block', windows, minutes);
    case 'track':
      return quickPolicies('always', 'track', windows, minutes);
  }
}

function Permissions() {
  const [host, setHost] = useState<boolean | null>(null);
  const [incognito, setIncognito] = useState<boolean | null>(null);
  const [notif, setNotif] = useState<boolean | null>(null);
  const refresh = async () => {
    setHost(await api.permissions.contains({ origins: ['<all_urls>'] }).catch(() => true));
    setIncognito(await api.extension.isAllowedIncognitoAccess().catch(() => false));
    setNotif(await api.permissions.contains({ permissions: ['notifications'] }).catch(() => false));
  };
  useEffect(() => {
    void refresh();
  }, []);
  const b = browserName();
  return (
    <div class="stack">
      <div class="row nowrap top">
        <Icon name={host ? 'check' : 'alert'} />
        <div class="stack grow" style={{ gap: '2px' }}>
          <strong>{t('welcome.perm.host')}</strong>
          <span class="small muted">{t('welcome.perm.hostHelp')}</span>
        </div>
        {host === false && (
          <Button
            size="small"
            variant="primary"
            onClick={async () => {
              await api.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
              await call('permissions.changed', {});
              void refresh();
            }}
          >
            {t('welcome.perm.grant')}
          </Button>
        )}
      </div>
      <div class="row nowrap top">
        <Icon name={incognito ? 'check' : 'info'} />
        <div class="stack grow" style={{ gap: '2px' }}>
          <strong>{incognito ? t('welcome.perm.incognitoOk') : t('welcome.perm.incognito')}</strong>
          {!incognito && (
            <span class="small muted">
              {t(
                b === 'chrome' || b === 'edge'
                  ? 'checklist.incognito.chrome'
                  : b === 'firefox-android'
                    ? 'checklist.incognito.android'
                    : 'checklist.incognito.firefox',
              )}
            </span>
          )}
        </div>
        <Button size="small" variant="ghost" onClick={refresh}>
          {t('welcome.perm.check')}
        </Button>
      </div>
      <div class="row nowrap top">
        <Icon name={notif ? 'check' : 'bell'} />
        <div class="stack grow" style={{ gap: '2px' }}>
          <strong>{t('welcome.perm.notifications')}</strong>
          <span class="small muted">{t('welcome.perm.notificationsHelp')}</span>
        </div>
        {!notif && (
          <Button
            size="small"
            onClick={async () => {
              const ok = await api.permissions.request({ permissions: ['notifications'] }).catch(() => false);
              setNotif(ok);
            }}
          >
            {t('welcome.perm.enable')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function WelcomePage() {
  const { model } = useDashboard();
  const flow = useSaveFlow();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<Goal>('friction');
  const [templates, setTemplates] = useState<string[]>(['social', 'video']);
  const [custom, setCustom] = useState<Target[]>([]);
  const [windows, setWindows] = useState<TimeWindow[]>(() => clone(SCHEDULE_PRESETS.office));
  const [minutes, setMinutes] = useState(30);
  const [style, setStyle] = useState<Style>('ask');
  const [level, setLevel] = useState<ProtectionLevel>('balanced');
  const steps = ['goal', 'sites', 'when', 'style', 'protection', 'permissions', 'summary'];

  useEffect(() => {
    setStyle(goal === 'block' || goal === 'schedule' ? 'block' : 'ask');
  }, [goal]);

  const groups: Group[] = [
    ...templates.map((id) => {
      const tpl = TEMPLATES.find((x) => x.id === id)!;
      const policies = policiesFor(
        goal,
        tpl.style === 'block' && goal !== 'track' ? 'block' : style,
        windows,
        minutes,
      );
      return newGroup({
        name: t(tpl.nameKey),
        color: tpl.color,
        icon: tpl.icon,
        targets: targetsFromSites(tpl.sites),
        policies,
        pause: pausePolicyFor(level),
      });
    }),
    ...(custom.length
      ? [
          newGroup({
            name: t('welcome.mySites'),
            color: GROUP_COLORS[0],
            targets: custom,
            policies: policiesFor(goal, style, windows, minutes),
            pause: pausePolicyFor(level),
          }),
        ]
      : []),
  ];

  const finish = async () => {
    const next = clone(model.config);
    next.groups.push(...groups);
    next.settings.protection.level = level;
    next.settings.onboarded = true;
    const ok = await flow.run(call('config.save', { config: next }));
    if (ok) {
      toast(t('welcome.done'));
      navigate('/today');
    }
  };
  const skip = async () => {
    sessionStorage.setItem('whb-skip-welcome', '1');
    await call('onboarding.done', {});
    navigate('/today');
  };

  const skipWhen = goal === 'friction' || goal === 'block' || goal === 'track';
  const skipStyle = goal === 'block' || goal === 'track';
  const next = () => {
    let s = step + 1;
    if (steps[s] === 'when' && skipWhen) s++;
    if (steps[s] === 'style' && skipStyle) s++;
    setStep(s);
  };
  const back = () => {
    let s = step - 1;
    if (steps[s] === 'style' && skipStyle) s--;
    if (steps[s] === 'when' && skipWhen) s--;
    setStep(Math.max(0, s));
  };

  if (step === -1 || (step === 0 && false)) return null;
  const name = steps[step];
  return (
    <div class="wizard stack stack-lg">
      <div class="row between">
        <div class="row nowrap">
          <BrakeLogo size={32} />
          <strong>WebHandbrake</strong>
        </div>
        <button type="button" class="link-btn small" onClick={skip}>
          {t('welcome.skip')}
        </button>
      </div>
      <div class="wizard-steps" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s} class={i <= step ? 'done' : ''} />
        ))}
      </div>
      <p class="tiny muted">{t('welcome.step', { n: step + 1, total: steps.length })}</p>

      {name === 'goal' && (
        <section class="stack">
          <h1>{t('welcome.title')}</h1>
          <p class="text-2">{t('welcome.intro')}</p>
          <h2>{t('welcome.goal')}</h2>
          <div class="stack" role="radiogroup" aria-label={t('welcome.goal')}>
            {GOALS.map((g) => (
              <button
                key={g.id}
                type="button"
                role="radio"
                class="choice"
                aria-checked={goal === g.id}
                onClick={() => setGoal(g.id)}
              >
                <Icon name={g.icon} />
                <span>
                  <strong>{t(`welcome.goal.${g.id}`)}</strong>
                  <span class="small muted">{t(`welcome.goal.${g.id}.desc`)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {name === 'sites' && (
        <section class="stack">
          <h1>{t('welcome.sites')}</h1>
          <p class="text-2">{t('welcome.sitesIntro')}</p>
          <div class="chips" role="group" aria-label={t('welcome.templates')}>
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                class="chip"
                aria-pressed={templates.includes(tpl.id)}
                onClick={() =>
                  setTemplates(
                    templates.includes(tpl.id)
                      ? templates.filter((x) => x !== tpl.id)
                      : [...templates, tpl.id],
                  )
                }
              >
                <Icon name={tpl.icon} />
                {t(tpl.nameKey)}
              </button>
            ))}
          </div>
          <h3>{t('welcome.customSites')}</h3>
          <TargetsEditor targets={custom} onChange={setCustom} advanced={false} exceptions={false} />
        </section>
      )}

      {name === 'when' && goal === 'schedule' && (
        <section class="stack">
          <h1>{t('welcome.when')}</h1>
          <p class="text-2">{t('welcome.whenIntro')}</p>
          <WindowsEditor windows={windows} onChange={setWindows} />
        </section>
      )}
      {name === 'when' && goal === 'limit' && (
        <section class="stack">
          <h1>{t('welcome.limit')}</h1>
          <p class="text-2">{t('welcome.limitIntro')}</p>
          <Chips
            value={minutes}
            onChange={setMinutes}
            label={t('welcome.limit')}
            options={[15, 30, 45, 60, 90, 120].map((m) => ({
              value: m,
              label: t('welcome.perDay', { minutes: m }),
            }))}
          />
        </section>
      )}

      {name === 'style' && (
        <section class="stack">
          <h1>{t('welcome.style')}</h1>
          <p class="text-2">{t('welcome.styleIntro')}</p>
          <div class="stack" role="radiogroup" aria-label={t('welcome.style')}>
            {(['ask', 'delay', 'block'] as Style[]).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                class="choice"
                aria-checked={style === s}
                onClick={() => setStyle(s)}
              >
                <Icon name={s === 'ask' ? 'chat' : s === 'delay' ? 'hourglass' : 'ban'} />
                <span>
                  <strong>{t(`welcome.style.${s}`)}</strong>
                  <span class="small muted">{t(`welcome.style.${s}.desc`)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {name === 'protection' && (
        <section class="stack">
          <h1>{t('welcome.protection')}</h1>
          <p class="text-2">{t('welcome.protectionIntro')}</p>
          <div class="stack" role="radiogroup" aria-label={t('welcome.protection')}>
            {(['soft', 'balanced', 'strict'] as ProtectionLevel[]).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                class="choice"
                aria-checked={level === l}
                onClick={() => setLevel(l)}
              >
                <Icon name={levelIcon(l)} />
                <span class="stack stack-sm">
                  <strong>{t(`level.${l}`)}</strong>
                  <LevelExplanation level={l} />
                </span>
              </button>
            ))}
          </div>
          <p class="small muted">{t('welcome.lockedLater')}</p>
        </section>
      )}

      {name === 'permissions' && (
        <section class="stack">
          <h1>{t('welcome.permissions')}</h1>
          <p class="text-2">{t('welcome.permissionsIntro')}</p>
          <Permissions />
        </section>
      )}

      {name === 'summary' && (
        <section class="stack">
          <h1>{t('welcome.summary')}</h1>
          {groups.length === 0 ? (
            <Banner kind="warning">{t('welcome.noSites')}</Banner>
          ) : (
            groups.map((g) => (
              <div key={g.id} class="card tight stack stack-sm">
                <strong>
                  {g.name} <span class="muted small">({t('groups.sites', { count: g.targets.length })})</span>
                </strong>
                {summarizeGroup(g).map((l, i) => (
                  <p key={i} class="small">
                    {l}
                  </p>
                ))}
              </div>
            ))
          )}
          <p class="small">{t('welcome.summaryLevel', { level: t(`level.${level}`) })}</p>
          <p class="small muted">{t('welcome.summaryNote')}</p>
        </section>
      )}

      <div class="row between">
        <Button variant="ghost" onClick={back} disabled={step === 0} icon="chevron-left">
          {t('welcome.back')}
        </Button>
        {name === 'summary' ? (
          <Button variant="primary" size="large" disabled={!groups.length} onClick={finish}>
            {t('welcome.create')}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={next}
            disabled={name === 'sites' && !templates.length && !custom.length}
          >
            {t('welcome.next')}
          </Button>
        )}
      </div>
      {flow.element}
    </div>
  );
}
