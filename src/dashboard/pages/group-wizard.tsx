/**
 * A new rule from Rules: the steps of `RuleWizard`, with the full editor
 * one link away. First run shows the same steps for the first rule.
 */

import { clone } from '../../engine/json';
import { t } from '../../i18n/i18n';
import { call } from '../../shared/rpc';
import { toast } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { RuleWizard } from '../components/rule-wizard';
import { useDashboard } from '../context';
import { navigate } from '../router';
import { setEditorHandoff } from './group-editor';

/** The draft of a new rule, kept for the session. */
const STORE = 'whb-new-rule';

export function GroupWizardPage({ template }: { template: string | null }) {
  const { model } = useDashboard();
  const flow = useSaveFlow();

  return (
    <>
      <RuleWizard
        store={STORE}
        template={template}
        head={
          <div>
            <a href="#/groups" class="back quiet">
              <Icon name="chevron-left" />
              {t('nav.groups')}
            </a>
            <h1>{t('wizard.title')}</h1>
          </div>
        }
        onCancel={() => navigate('/groups')}
        onFullEditor={(draft) => {
          setEditorHandoff(draft);
          navigate('/groups/new?full=1');
        }}
        create={async (g) => {
          const next = clone(model.config);
          next.groups.push(g);
          const ok = await flow.run(call('config.save', { config: next }));
          if (ok) {
            navigate('/groups');
            toast(t('wizard.created', { name: g.name }), {
              label: t('wizard.open'),
              run: () => navigate(`/groups/${g.id}`),
            });
          }
          return ok;
        }}
      />
      {flow.element}
    </>
  );
}
