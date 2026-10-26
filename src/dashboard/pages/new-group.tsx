/**
 * A new rule from Rules: the parts of the rule editor (`RuleEditor`) in order. First run shows the
 * same parts for the first rule.
 */

import { clone } from '../../engine/json';
import { t } from '../../i18n/i18n';
import type { RulePage } from '../../shared/block-site';
import { call } from '../../shared/rpc';
import { toast } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { RuleEditor } from '../components/rule-editor';
import { useDashboard } from '../context';
import { navigate } from '../router';

/** The draft of a new rule, kept for the session. */
const STORE = 'whb-new-rule';

/** `page`: "Block this site" › New rule… starts the rule with the page in it, blocked at all times. */
export function NewGroupPage({ template, page = null }: { template: string | null; page?: RulePage | null }) {
  const { model } = useDashboard();
  const flow = useSaveFlow();

  return (
    <>
      <RuleEditor
        mode="create"
        store={STORE}
        template={template}
        page={page}
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
