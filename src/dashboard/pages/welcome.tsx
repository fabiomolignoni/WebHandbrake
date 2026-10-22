/**
 * First run: a welcome that states the value and the privacy
 * promise, then the parts of the rule editor (`RuleEditor`) in order for a first rule, and a
 * "you're set" screen with the next steps. Skippable and resumable within the session.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { clone } from '../../engine/json';
import { isNav } from '../../engine/severity';
import type { Group } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { api, browserName } from '../../platform/api';
import { formatWhen } from '../../shared/format';
import type { DecisionView } from '../../shared/models';
import { call } from '../../shared/rpc';
import { Button, ToneIcon } from '../../ui/components';
import { BrakeLogo, Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { discardRuleDraft, hasRuleDraft, RuleEditor } from '../components/rule-editor';
import { useDashboard } from '../context';
import { navigate } from '../router';

type Screen = 'welcome' | 'rule' | 'done';

/** The draft of the first rule, kept for the session: closing the tab by mistake loses nothing. */
const STORE = 'whb-first-rule';

/** A site to show as an example: a plain address. */
const sampleSite = (g: Group) =>
  g.targets.find((x) => !x.allow && x.type === 'domain' && !x.value.includes('*'))?.value;

/** What opening the example site shows now, or when the rule will step in on it. */
function tryText(site: string, d: DecisionView | null): string {
  if (!d || isNav(d)) return t('welcome.try.body', { site });
  if (d.restriction?.kind === 'budget') return t('welcome.try.afterLimit', { site });
  if (d.restriction) return t('welcome.try.later', { site, when: formatWhen(d.restriction.at) });
  return t('welcome.try.notNow', { site });
}

export function WelcomePage() {
  const { model } = useDashboard();
  const flow = useSaveFlow();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // A setup in progress resumes at its steps.
  const [screen, setScreen] = useState<Screen>(() => (hasRuleDraft(STORE) ? 'rule' : 'welcome'));
  const [created, setCreated] = useState<Group | null>(null);
  const [hostAccess, setHostAccess] = useState<boolean | null>(null);
  const [incognito, setIncognito] = useState<boolean | null>(null);

  // Focus follows the screen; the steps move it to their own heading.
  useEffect(() => {
    titleRef.current?.focus();
    window.scrollTo(0, 0);
  }, [screen]);
  // The one permission the rule needs is asked in context, only when it is missing.
  useEffect(() => {
    if (screen === 'rule')
      void api.permissions
        .contains({ origins: ['<all_urls>'] })
        .then(setHostAccess)
        .catch(() => setHostAccess(true));
    if (screen === 'done')
      void api.extension
        .isAllowedIncognitoAccess()
        .then(setIncognito)
        .catch(() => setIncognito(true));
  }, [screen]);

  const skip = async () => {
    discardRuleDraft(STORE);
    sessionStorage.setItem('whb-skip-welcome', '1');
    await call('onboarding.done', {});
    navigate('/today');
  };
  const create = async (g: Group) => {
    const cfg = clone(model.config);
    cfg.groups.push(g);
    cfg.settings.onboarded = true;
    const result = await call('config.save', { config: cfg });
    // A new rule is a strengthening and is applied at once. Once it exists the setup is over,
    // whatever else the save waits for: trying again would add it twice.
    const added = result.applied.some((u) => u.kind === 'group.add');
    const ok = await flow.run(Promise.resolve(result));
    if (!ok && !added) return false;
    sessionStorage.setItem('whb-skip-welcome', '1');
    setCreated(g);
    setScreen('done');
    return true;
  };

  // "Count only" restricts nothing: there is nothing to try.
  const firstSite = created?.policies.some((p) => p.intervention.type !== 'track')
    ? sampleSite(created)
    : undefined;
  // Outside the rule's times, or within its limit, the site opens normally: trying it then would
  // look as if the rule did not work, so the step says when the rule steps in instead.
  const [sample, setSample] = useState<DecisionView | null>(null);
  useEffect(() => {
    if (!firstSite) return;
    void call('explain', { url: `https://${firstSite}` })
      .then(setSample)
      .catch(() => {});
  }, [firstSite]);
  const tryNow = !sample || isNav(sample);
  const browser = browserName();

  // ---------------------------------------------------------------- welcome
  if (screen === 'welcome') {
    return (
      <div class="onb onb-welcome stack stack-xl">
        <div class="stack stack-lg center onb-hero">
          <BrakeLogo size={64} />
          <h1 ref={titleRef} tabIndex={-1}>
            {t('welcome.title')}
          </h1>
          <p class="onb-lead">{t('welcome.lead')}</p>
        </div>
        <ul class="value-list plain">
          {(['gentle', 'firm', 'private'] as const).map((v) => (
            <li key={v}>
              <ToneIcon
                tone={v === 'gentle' ? 'friction' : v === 'firm' ? 'protected' : 'free'}
                icon={v === 'gentle' ? 'wind' : v === 'firm' ? 'shield' : 'lock'}
                size={44}
              />
              <span class="stack stack-xs">
                <strong>{t(`welcome.value.${v}.title`)}</strong>
                <span class="text-2">{t(`welcome.value.${v}.text`)}</span>
              </span>
            </li>
          ))}
        </ul>
        <div class="stack center" style={{ alignItems: 'center' }}>
          <div class="row center onb-choices">
            <Button variant="primary" size="large" icon="arrow-right" onClick={() => setScreen('rule')}>
              {t('welcome.begin')}
            </Button>
            <Button size="large" onClick={skip}>
              {t('welcome.skip')}
            </Button>
          </div>
          <p class="small muted">{t('welcome.startSmall')}</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- done
  if (screen === 'done' && created) {
    return (
      <div class="onb stack stack-xl">
        <div class="stack stack-lg center onb-hero">
          <ToneIcon tone="free" icon="check-circle" size={72} round />
          <h1 ref={titleRef} tabIndex={-1}>
            {t('welcome.done.title')}
          </h1>
          <p class="onb-lead">{t('welcome.done.body', { name: created.name })}</p>
        </div>
        <section class="card stack" aria-labelledby="next-steps">
          <h2 id="next-steps">{t('welcome.done.next')}</h2>
          <ol class="next-steps plain">
            <li>
              <ToneIcon tone="neutral" icon="pin" size={40} />
              <span class="stack stack-xs">
                <strong>
                  {browser === 'firefox-android' ? t('welcome.pin.titleAndroid') : t('welcome.pin.title')}
                </strong>
                <span class="small text-2">
                  {t(
                    browser === 'firefox-android'
                      ? 'welcome.pin.android'
                      : browser === 'firefox'
                        ? 'welcome.pin.firefox'
                        : 'welcome.pin.chrome',
                  )}
                </span>
                <span class="small muted">{t('welcome.pin.why')}</span>
              </span>
            </li>
            {firstSite && (
              <li>
                <ToneIcon tone="friction" icon="play" size={40} />
                <span class="stack stack-xs grow">
                  <strong>{tryNow ? t('welcome.try.title') : t('welcome.try.laterTitle')}</strong>
                  <span class="small text-2">{tryText(firstSite, sample)}</span>
                </span>
                {tryNow && (
                  <Button
                    size="small"
                    icon="external"
                    onClick={() => void call('tabs.open', { url: `https://${firstSite}` })}
                  >
                    {t('welcome.try.action')}
                  </Button>
                )}
              </li>
            )}
            {incognito === false && (
              <li>
                <ToneIcon tone="calm" icon="eye-off" size={40} />
                <span class="stack stack-xs">
                  <strong>{t('welcome.private.title')}</strong>
                  <span class="small text-2">
                    {t(
                      browser === 'chrome' || browser === 'edge'
                        ? 'checklist.incognito.chrome'
                        : browser === 'firefox-android'
                          ? 'checklist.incognito.android'
                          : 'checklist.incognito.firefox',
                    )}
                    {model.browserPagesBlocked && <> {t('checklist.incognito.blockedNow')}</>}
                  </span>
                </span>
              </li>
            )}
          </ol>
        </section>
        <div class="row center">
          <Button variant="primary" size="large" icon="arrow-right" onClick={() => navigate('/today')}>
            {t('welcome.done.go')}
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- the parts of the rule
  return (
    <>
      <RuleEditor
        mode="create"
        store={STORE}
        class="onb"
        head={
          <>
            <div>
              <span class="onb-brand">
                <BrakeLogo size={20} />
                WebHandbrake
              </span>
              <h1>{t('welcome.firstRule')}</h1>
            </div>
            <button type="button" class="link-btn small" onClick={skip}>
              {t('welcome.skip')}
            </button>
          </>
        }
        before={t('welcome.installed')}
        onBack={() => setScreen('welcome')}
        create={create}
        review={
          hostAccess === false && (
            <div class="option-panel row nowrap top" style={{ gap: '12px' }}>
              <Icon name="globe" />
              <div class="stack stack-sm grow">
                <strong>{t('welcome.perm.title')}</strong>
                <span class="small text-2">{t('welcome.perm.body')}</span>
                <Button
                  size="small"
                  variant="primary"
                  onClick={async () => {
                    const ok = await api.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
                    await call('permissions.changed', {});
                    setHostAccess(ok);
                  }}
                >
                  {t('welcome.perm.grant')}
                </Button>
              </div>
            </div>
          )
        }
      />
      {flow.element}
    </>
  );
}
