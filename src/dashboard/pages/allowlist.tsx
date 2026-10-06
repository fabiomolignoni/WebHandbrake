/** "Always allowed" global list (SEM-05): prevails over every group and session; adding is a weakening. */

import { useEffect, useState } from 'preact/hooks';
import type { Target } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { call } from '../../shared/rpc';
import { Banner, Button } from '../../ui/components';
import { useSaveFlow } from '../../ui/saveflow';
import { TargetsEditor } from '../components/targets';
import { clone, useDashboard } from '../context';
import { setNavigationGuard } from '../router';
import { GroupsNav } from './groups';

export function AllowlistPage() {
  const { model } = useDashboard();
  const cfg = model.config;
  const [draft, setDraft] = useState<Target[]>(() => clone(cfg.allowlist));
  // Last version synchronised with the background, so background changes are not "unsaved".
  const [synced, setSynced] = useState(() => JSON.stringify(cfg.allowlist));
  const adopt = (list: Target[]) => {
    setDraft(clone(list));
    setSynced(JSON.stringify(list));
  };
  const flow = useSaveFlow();
  const dirty = JSON.stringify(draft) !== synced;
  useEffect(() => {
    if (!dirty) adopt(cfg.allowlist);
  }, [cfg.allowlist]);
  useEffect(() => {
    setNavigationGuard(() => dirty);
    return () => setNavigationGuard(null);
  }, [dirty]);
  const save = async () => {
    const next = clone(cfg);
    next.allowlist = draft.map((x) => ({ ...x, allow: undefined }));
    await flow.run(call('config.save', { config: next }));
    setNavigationGuard(null);
    adopt((await call('config.get', {})).config.allowlist);
  };
  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <h1>{t('allowlist.title')}</h1>
          <p>{t('allowlist.subtitle')}</p>
        </div>
      </div>
      <GroupsNav current="allowlist" />
      <Banner kind="info">{t('allowlist.note')}</Banner>
      <div class="card stack">
        <TargetsEditor
          targets={draft}
          onChange={setDraft}
          advanced={cfg.settings.advanced}
          exceptions={false}
        />
      </div>
      <div class="sticky-actions row">
        <Button variant="primary" disabled={!dirty} onClick={save}>
          {t('editor.save')}
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => adopt(cfg.allowlist)}>
            {t('editor.discard')}
          </Button>
        )}
      </div>
      {flow.element}
    </div>
  );
}
