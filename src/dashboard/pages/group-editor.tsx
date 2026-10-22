/**
 * A rule in the rule editor (`RuleEditor`): the rule as it is, to change. The address of a rule
 * that does not exist starts a new one; a rule deleted while it is open stays on screen until the
 * editor is left.
 */

import { useState } from 'preact/hooks';
import { RuleEditor } from '../components/rule-editor';
import { useDashboard } from '../context';
import { NewGroupPage } from './new-group';

export function GroupEditorPage({
  id,
  step,
}: {
  id: string;
  /** The part to open first (`?step=`), for links such as Protection's "Change". */
  step?: string | null;
}) {
  const { model } = useDashboard();
  const [exists] = useState(() => model.config.groups.some((g) => g.id === id));
  return exists ? <RuleEditor mode="edit" id={id} step={step} /> : <NewGroupPage template={null} />;
}
