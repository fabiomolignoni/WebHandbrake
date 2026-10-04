/** Shared lists (MAT-18): reusable by several groups. */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { newId } from '../../engine/defaults';
import type { SharedList } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { call } from '../../shared/rpc';
import { Button, Dialog, Empty, Field } from '../../ui/components';
import { useSaveFlow } from '../../ui/saveflow';
import { TargetsEditor } from '../components/targets';
import { clone, useDashboard } from '../context';
import { navigate, setNavigationGuard } from '../router';

export function ListsPage() {
  const { model } = useDashboard();
  const cfg = model.config;
  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <a href="#/groups" class="small">
            ← {t('nav.groups')}
          </a>
          <h1>{t('lists.title')}</h1>
          <p>{t('lists.subtitle')}</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => navigate(`/lists/new`)}>
          {t('lists.new')}
        </Button>
      </div>
      {cfg.lists.length === 0 ? (
        <div class="card">
          <Empty icon="list" title={t('lists.empty')} />
        </div>
      ) : (
        <ul class="list">
          {cfg.lists.map((l) => {
            const used = cfg.groups.filter((g) => g.lists.includes(l.id));
            return (
              <li key={l.id} class="row between">
                <div class="stack" style={{ gap: '2px' }}>
                  <a href={`#/lists/${l.id}`}>
                    <strong>{l.name}</strong>
                  </a>
                  <span class="small muted">
                    {t('lists.entries', { count: l.targets.length })} ·{' '}
                    {used.length
                      ? t('lists.usedBy', { groups: used.map((g) => g.name).join(', ') })
                      : t('lists.unused')}
                  </span>
                </div>
                <Button size="small" icon="edit" onClick={() => navigate(`/lists/${l.id}`)}>
                  {t('common.edit')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ListEditorPage({ id }: { id: string }) {
  const { model } = useDashboard();
  const cfg = model.config;
  const existing = cfg.lists.find((l) => l.id === id) ?? null;
  const base = useMemo<SharedList>(
    () => existing ?? { id: newId(), rev: 1, updatedAt: Date.now(), name: '', targets: [] },
    [id],
  );
  const [draft, setDraft] = useState<SharedList>(() => clone(base));
  const [confirm, setConfirm] = useState(false);
  const flow = useSaveFlow();
  const dirty = JSON.stringify(draft) !== JSON.stringify(existing ?? base);
  useEffect(() => {
    setNavigationGuard(() => dirty);
    return () => setNavigationGuard(null);
  }, [dirty]);
  const used = cfg.groups.filter((g) => g.lists.includes(draft.id));

  const save = async () => {
    const next = clone(cfg);
    const i = next.lists.findIndex((l) => l.id === draft.id);
    if (i === -1) next.lists.push(draft);
    else next.lists[i] = draft;
    await flow.run(call('config.save', { config: next }));
    setNavigationGuard(null);
    const fresh = (await call('config.get', {})).config.lists.find((l) => l.id === draft.id);
    if (fresh) setDraft(clone(fresh));
    if (!existing) navigate(`/lists/${draft.id}`);
  };
  const remove = async () => {
    const next = clone(cfg);
    next.lists = next.lists.filter((l) => l.id !== draft.id);
    next.groups = next.groups.map((g) => ({ ...g, lists: g.lists.filter((x) => x !== draft.id) }));
    if (await flow.run(call('config.save', { config: next }))) {
      setNavigationGuard(null);
      navigate('/lists');
    }
  };
  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <a href="#/lists" class="small">
            ← {t('lists.title')}
          </a>
          <h1>{draft.name || t('lists.newTitle')}</h1>
          {used.length > 0 && <p>{t('lists.usedBy', { groups: used.map((g) => g.name).join(', ') })}</p>}
        </div>
      </div>
      <div class="card stack">
        <Field label={t('lists.name')}>
          {(fid) => (
            <input
              id={fid}
              class="input"
              value={draft.name}
              maxLength={80}
              onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })}
            />
          )}
        </Field>
        <TargetsEditor
          targets={draft.targets}
          onChange={(targets) => setDraft({ ...draft, targets })}
          advanced={cfg.settings.advanced}
        />
      </div>
      <div class="sticky-actions row between">
        <div class="row">
          <Button variant="primary" disabled={!draft.name.trim() || !dirty} onClick={save}>
            {existing ? t('editor.save') : t('editor.create')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => (dirty ? setDraft(clone(existing ?? base)) : navigate('/lists'))}
          >
            {dirty ? t('editor.discard') : t('common.close')}
          </Button>
        </div>
        {existing && (
          <Button variant="danger" size="small" icon="trash" onClick={() => setConfirm(true)}>
            {t('lists.delete')}
          </Button>
        )}
      </div>
      {confirm && (
        <Dialog
          open
          onClose={() => setConfirm(false)}
          title={t('lists.deleteTitle', { name: draft.name })}
          actions={
            <>
              <Button variant="primary" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={remove}>
                {t('lists.delete')}
              </Button>
            </>
          }
        >
          <p>{t('lists.deleteBody')}</p>
        </Dialog>
      )}
      {flow.element}
    </div>
  );
}
