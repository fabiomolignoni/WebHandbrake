/** "Test a URL" / "Why?" (MAT-16), also for a group being edited and not saved yet. */

import { compileConfig } from '../engine/compile';
import { decide } from '../engine/decide';
import type { Group } from '../engine/types';
import type { DecisionView } from '../shared/models';
import { ctx, decisionView } from './engine';
import { store } from './store';

export function explainDraft(url: string, draft: Group | undefined, incognito: boolean): DecisionView {
  const base = ctx();
  if (!draft) return decisionView(decide(base, url, { incognito }), { incognito }, base);
  const config = {
    ...store.config,
    groups: store.config.groups.some((g) => g.id === draft.id)
      ? store.config.groups.map((g) => (g.id === draft.id ? draft : g))
      : [...store.config.groups, draft],
  };
  const c = { ...base, cc: compileConfig(config) };
  return decisionView(decide(c, url, { incognito }), { incognito }, c);
}
