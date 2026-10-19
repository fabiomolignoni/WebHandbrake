/**
 * Groups list: clickable rows with what each rule does, switch and an
 * overflow menu for rare actions; search, filter, reorder (drag and drop or menu), duplicate,
 * archive, share, templates.
 */

import { useState } from 'preact/hooks';
import { isGroupActive } from '../../engine/compile';
import { newId } from '../../engine/defaults';
import { clone } from '../../engine/json';
import type { Group } from '../../engine/types';
import { t } from '../../i18n/i18n';
import type { GroupStatus } from '../../shared/models';
import { call } from '../../shared/rpc';
import { summarizeGroup } from '../../shared/summary';
import { Button, Empty, GroupTile, Menu, Segmented, Toggle, TypePills } from '../../ui/components';
import { downloadText } from '../../ui/download';
import { useModel } from '../../ui/hooks';
import { Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { ruleTypes } from '../../ui/status';
import { protectionIcon, protectionLabel } from '../components/protection-picker';
import { useDashboard } from '../context';
import { navigate } from '../router';

type Filter = 'all' | 'active' | 'disabled' | 'archived';

/** The first few sites. */
function sitesPreview(g: Group): string {
  const sites = g.targets.filter((x) => !x.allow).map((x) => x.value);
  const shown = sites.slice(0, 3);
  if (!shown.length) return '';
  const more = sites.length - shown.length;
  return more > 0 ? t('groups.sitesMore', { sites: shown.join(', '), count: more }) : shown.join(', ');
}

export function GroupsPage() {
  const { model } = useDashboard();
  const cfg = model.config;
  const { data: overview } = useModel('overview.get', {});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
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
        <Button variant="primary" icon="plus" onClick={() => navigate('/groups/new')}>
          {t('groups.new')}
        </Button>
      </div>
      <div class="toolbar">
        <div class="search input-icon">
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
        <Segmented<Filter>
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
      </div>
      {groups.length === 0 ? (
        <div class="card">
          <Empty icon="layers" title={cfg.groups.length ? t('groups.noMatch') : t('groups.empty')}>
            {!cfg.groups.length && (
              <Button variant="primary" icon="plus" onClick={() => navigate('/groups/new')}>
                {t('groups.new')}
              </Button>
            )}
          </Empty>
        </div>
      ) : (
        <ul class="group-list" aria-label={t('groups.title')}>
          {groups.map((g) => {
            const s: GroupStatus | undefined = status.get(g.id);
            const index = cfg.groups.indexOf(g);
            const sites = g.targets.filter((x) => !x.allow).length;
            return (
              <li
                key={g.id}
                class={`card card-link group-row${isGroupActive(g) ? '' : ' off'}${dragId === g.id ? ' dragging' : ''}`}
                draggable
                onDragStart={() => setDragId(g.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== g.id) void move(dragId, index);
                  setDragId(null);
                }}
              >
                <div class="lead">
                  <span class="grip" aria-hidden="true" title={t('groups.dragHint')}>
                    <Icon name="grip" />
                  </span>
                  <GroupTile color={g.color} icon={g.icon} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div class="title">
                    <a class="stretched" href={`#/groups/${g.id}`}>
                      <strong>{g.name}</strong>
                    </a>
                    {g.archived && <span class="tag">{t('groups.archived')}</span>}
                    {s && (
                      <span class="tag" title={t('protection.level')}>
                        <Icon name={protectionIcon(s.protection.kind)} /> {protectionLabel(s.protection)}
                      </span>
                    )}
                  </div>
                  <p class="sites ellipsis" title={sitesPreview(g) || undefined}>
                    {t('groups.sites', { count: sites })}
                    {sitesPreview(g) && ` · ${sitesPreview(g)}`}
                  </p>
                  <div class="rules">
                    {summarizeGroup(g).map((line, i) => (
                      <span key={i}>{line}</span>
                    ))}
                  </div>
                </div>
                <div class="trail above">
                  <TypePills types={ruleTypes(g.policies)} />
                  <span class="row nowrap" style={{ gap: '4px' }}>
                    {!g.archived && (
                      <Toggle
                        compact
                        checked={g.enabled}
                        onChange={(enabled) => void patchGroup(g.id, { enabled })}
                        label={<span class="sr-only">{t('groups.enable', { name: g.name })}</span>}
                      />
                    )}
                    <Menu
                      label={t('groups.actions', { name: g.name })}
                      items={[
                        {
                          label: t('common.edit'),
                          icon: 'edit',
                          onSelect: () => navigate(`/groups/${g.id}`),
                        },
                        { label: t('groups.duplicate'), icon: 'copy', onSelect: () => void duplicate(g) },
                        {
                          label: t('groups.export'),
                          icon: 'download',
                          onSelect: async () => {
                            const r = await call('group.export', { groupId: g.id });
                            downloadText(r.filename, r.text);
                          },
                        },
                        'separator',
                        {
                          label: t('groups.moveUp'),
                          icon: 'chevron-up',
                          disabled: index === 0,
                          onSelect: () => void move(g.id, index - 1),
                        },
                        {
                          label: t('groups.moveDown'),
                          icon: 'chevron-down',
                          disabled: index === cfg.groups.length - 1,
                          onSelect: () => void move(g.id, index + 1),
                        },
                        'separator',
                        {
                          label: g.archived ? t('groups.unarchive') : t('groups.archive'),
                          icon: 'archive',
                          onSelect: () => void patchGroup(g.id, { archived: !g.archived }),
                        },
                      ]}
                    />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p class="help">{t('groups.orderNote')}</p>
      {flow.element}
    </div>
  );
}
