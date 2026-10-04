/** "Later" list (INT-12): pages saved from interventions, reopened when allowed. */

import { t } from '../../i18n/i18n';
import { formatDateTime } from '../../shared/format';
import { call } from '../../shared/rpc';
import { Button, Empty, IconButton, Spinner, Toggle, toast } from '../../ui/components';
import { useModel } from '../../ui/hooks';
import { useSaveFlow } from '../../ui/saveflow';
import { clone, useDashboard } from '../context';

export function LaterPage() {
  const { model } = useDashboard();
  const { data, reload } = useModel('later.list', {});
  const flow = useSaveFlow();
  if (!data) return <Spinner />;
  const available = data.items.filter((i) => i.allowedNow);
  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <h1>{t('later.title')}</h1>
          <p>{t('later.subtitle')}</p>
        </div>
        {available.length > 0 && (
          <Button
            variant="primary"
            icon="external"
            onClick={async () => {
              const r = await call('later.open', { ids: available.map((i) => i.id) });
              toast(t('later.opened', { count: r.opened }));
              void reload();
            }}
          >
            {t('later.openAll', { count: available.length })}
          </Button>
        )}
      </div>
      <Toggle
        checked={model.config.settings.later.notify}
        label={t('later.notify')}
        help={t('later.notifyHelp')}
        onChange={(notify) => {
          const next = clone(model.config);
          next.settings.later.notify = notify;
          void flow.run(call('config.save', { config: next }));
        }}
      />
      {data.items.length === 0 ? (
        <div class="card">
          <Empty icon="bookmark" title={t('later.empty')}>
            <p class="small">{t('later.emptyHelp')}</p>
          </Empty>
        </div>
      ) : (
        <ul class="list">
          {data.items.map((i) => (
            <li key={i.id} class="row between nowrap">
              <div class="stack grow" style={{ gap: '2px' }}>
                <strong class="ellipsis">{i.title || i.url}</strong>
                <span class="small muted ellipsis">{i.url}</span>
                <span class="tiny muted">
                  {t('later.saved', { when: formatDateTime(i.savedAt) })} ·{' '}
                  {i.allowedNow ? t('later.available') : t('later.notYet')}
                </span>
              </div>
              <div class="row nowrap">
                <Button
                  size="small"
                  disabled={!i.allowedNow}
                  onClick={async () => {
                    await call('later.open', { ids: [i.id] });
                    void reload();
                  }}
                >
                  {t('later.open')}
                </Button>
                <IconButton
                  icon="trash"
                  size="small"
                  variant="ghost"
                  label={t('later.remove')}
                  onClick={async () => {
                    await call('later.remove', { ids: [i.id] });
                    void reload();
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {flow.element}
    </div>
  );
}
