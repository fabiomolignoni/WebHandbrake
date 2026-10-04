/** Groups list (§8.4.3, SET-04): search, filter, reorder, duplicate, archive, share, templates. */

import { useState } from 'preact/hooks';
import { TEMPLATES } from '../../data/templates';
import { newId } from '../../engine/defaults';
import type { Group } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { formatWhen } from '../../shared/format';
import type { GroupStatus } from '../../shared/models';
import { call } from '../../shared/rpc';
import { interventionName, summarizeGroup } from '../../shared/summary';
import { Button, ColorDot, Dialog, Empty, IconButton, Select, Toggle } from '../../ui/components';
import { downloadText } from '../../ui/download';
import { useModel } from '../../ui/hooks';
import { Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { clone, useDashboard } from '../context';
import { navigate } from '../router';

function stateTag(s: GroupStatus | undefined) {
  if (!s?.enabled) return null;
  if (s.pause) return <span class="tag calm">{t('groups.state.paused')}</span>;
  if (!s.intervention) return null;
  const type = s.intervention.type;
  if (type === 'track' || type === 'allow') return <span class="tag">{t('groups.state.allowed')}</span>;
  return (
    <span class="tag accent">
      {interventionName(type)}
      {s.until ? ` · ${t('groups.until', { when: formatWhen(s.until) })}` : ''}
    </span>
  );
}

export function GroupsPage() {
  const { model } = useDashboard();
  const cfg = model.config;
  const { data: overview } = useModel('overview.get', {});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'disabled' | 'archived'>('all');
  const [templates, setTemplates] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const flow = useSaveFlow();
  const status = new Map((overview?.groups ?? []).map((g) => [g.id, g]));

  const save = (next: typeof cfg) => flow.run(call('config.save', { config: next }));
  const patchGroup = (id: string, patch: Partial<Group>) => {
    const next = clone(cfg);
    next.groups = next.groups.map((g) => (g.id === id ? { ...g, ...patch } : g));
    return save(next);
  };
  const move = (id: string, to: number) => {
    const next = clone(cfg);
    const from = next.groups.findIndex((g) => g.id === id);
    const [g] = next.groups.splice(from, 1);
    next.groups.splice(Math.max(0, Math.min(next.groups.length, to)), 0, g);
    return save(next);
  };
  const duplicate = (g: Group) => {
    const next = clone(cfg);
    next.groups.push({
      ...clone(g),
      id: newId(),
      rev: 1,
      name: t('groups.copyName', { name: g.name }),
      targets: g.targets.map((x) => ({ ...x, id: newId() })),
      policies: g.policies.map((p) => ({ ...p, id: newId() })),
    });
    return save(next);
  };

  const q = query.trim().toLowerCase();
  const groups = cfg.groups.filter((g) => {
    if (filter === 'active' && (!g.enabled || g.archived)) return false;
    if (filter === 'disabled' && (g.enabled || g.archived)) return false;
    if (filter === 'archived' && !g.archived) return false;
    if (filter === 'all' && g.archived) return false;
    if (!q) return true;
    return g.name.toLowerCase().includes(q) || g.targets.some((x) => x.value.includes(q));
  });

  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <h1>{t('groups.title')}</h1>
          <p>{t('groups.subtitle')}</p>
        </div>
        <div class="row">
          <Button icon="layers" onClick={() => setTemplates(true)}>
            {t('groups.fromTemplate')}
          </Button>
          <Button variant="primary" icon="plus" onClick={() => navigate('/groups/new')}>
            {t('groups.new')}
          </Button>
        </div>
      </div>
      <div class="row">
        <div class="row nowrap grow" style={{ maxWidth: '360px' }}>
          <Icon name="search" />
          <input
            class="input"
            type="search"
            value={query}
            placeholder={t('groups.search')}
            aria-label={t('groups.search')}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </div>
        <span style={{ width: '180px' }}>
          <Select
            value={filter}
            onChange={setFilter}
            label={t('groups.filter')}
            options={[
              { value: 'all', label: t('groups.filter.all') },
              { value: 'active', label: t('groups.filter.active') },
              { value: 'disabled', label: t('groups.filter.disabled') },
              { value: 'archived', label: t('groups.filter.archived') },
            ]}
          />
        </span>
        <a href="#/lists" class="btn ghost small">
          <Icon name="list" />
          {t('nav.lists')}
        </a>
        <a href="#/allowlist" class="btn ghost small">
          <Icon name="check" />
          {t('nav.allowlist')}
        </a>
      </div>
      {groups.length === 0 ? (
        <div class="card">
          <Empty icon="layers" title={cfg.groups.length ? t('groups.noMatch') : t('groups.empty')}>
            {!cfg.groups.length && (
              <div class="row" style={{ justifyContent: 'center' }}>
                <Button variant="primary" onClick={() => setTemplates(true)}>
                  {t('groups.fromTemplate')}
                </Button>
                <Button onClick={() => navigate('/groups/new')}>{t('groups.new')}</Button>
              </div>
            )}
          </Empty>
        </div>
      ) : (
        <ul class="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={t('groups.title')}>
          {groups.map((g) => {
            const s = status.get(g.id);
            const index = cfg.groups.indexOf(g);
            return (
              <li
                key={g.id}
                class="card tight"
                draggable
                onDragStart={() => setDragId(g.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== g.id) void move(dragId, index);
                  setDragId(null);
                }}
                style={{ opacity: g.enabled ? 1 : 0.7 }}
              >
                <div class="row between nowrap top">
                  <div class="stack stack-sm grow">
                    <div class="row">
                      <Icon name="grip" class="muted" />
                      <ColorDot color={g.color} />
                      <a href={`#/groups/${g.id}`}>
                        <strong>{g.name}</strong>
                      </a>
                      <span class="muted small">
                        {t('groups.sites', { count: g.targets.filter((x) => !x.allow).length })}
                      </span>
                      {stateTag(s)}
                      {s && s.level !== 'soft' && (
                        <span class="tag" title={t('protection.level')}>
                          <Icon name="lock" /> {t(`level.${s.level}`)}
                        </span>
                      )}
                      {g.archived && <span class="tag">{t('groups.archived')}</span>}
                    </div>
                    {summarizeGroup(g).map((line, i) => (
                      <p key={i} class="small text-2">
                        {line}
                      </p>
                    ))}
                    {s?.nextChange && g.enabled && (
                      <p class="tiny muted">
                        {t('groups.nextChange', {
                          when: formatWhen(s.nextChange.at),
                          what: interventionName(s.nextChange.intervention.type),
                        })}
                      </p>
                    )}
                  </div>
                  <div class="row nowrap">
                    {!g.archived && (
                      <Toggle
                        checked={g.enabled}
                        onChange={(enabled) => void patchGroup(g.id, { enabled })}
                        label={<span class="sr-only">{t('groups.enable', { name: g.name })}</span>}
                      />
                    )}
                  </div>
                </div>
                <div class="row end compact-actions" style={{ marginTop: '8px' }}>
                  <IconButton
                    icon="chevron-up"
                    size="small"
                    variant="ghost"
                    label={t('groups.moveUp')}
                    disabled={index === 0}
                    onClick={() => void move(g.id, index - 1)}
                  />
                  <IconButton
                    icon="chevron-down"
                    size="small"
                    variant="ghost"
                    label={t('groups.moveDown')}
                    disabled={index === cfg.groups.length - 1}
                    onClick={() => void move(g.id, index + 1)}
                  />
                  <Button
                    size="small"
                    variant="ghost"
                    icon="edit"
                    onClick={() => navigate(`/groups/${g.id}`)}
                  >
                    <span class="btn-label">{t('common.edit')}</span>
                  </Button>
                  <Button size="small" variant="ghost" icon="copy" onClick={() => void duplicate(g)}>
                    <span class="btn-label">{t('groups.duplicate')}</span>
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    icon="download"
                    onClick={async () => {
                      const r = await call('group.export', { groupId: g.id });
                      downloadText(r.filename, r.text);
                    }}
                  >
                    <span class="btn-label">{t('groups.export')}</span>
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    icon="archive"
                    onClick={() => void patchGroup(g.id, { archived: !g.archived })}
                  >
                    <span class="btn-label">{g.archived ? t('groups.unarchive') : t('groups.archive')}</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p class="help">{t('groups.orderNote')}</p>
      {templates && (
        <Dialog open wide onClose={() => setTemplates(false)} title={t('groups.templatesTitle')}>
          <div class="grid" style={{ ['--min' as string]: '200px' }}>
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                class="choice"
                onClick={() => {
                  setTemplates(false);
                  navigate(`/groups/new?template=${tpl.id}`);
                }}
              >
                <Icon name={tpl.icon} />
                <span>
                  <strong>{t(tpl.nameKey)}</strong>
                  <span class="small muted">
                    {t('groups.templateSites', {
                      count: tpl.sites.length,
                      style: t(`templateStyle.${tpl.style}`),
                    })}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {flow.element}
    </div>
  );
}
