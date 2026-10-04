/** Shared dashboard state: the configuration model, refreshed on every background change. */

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ConfigModel } from '../shared/models';

export interface DashboardCtx {
  model: ConfigModel;
  reload: () => Promise<void>;
}

export const Ctx = createContext<DashboardCtx | null>(null);

export function useDashboard(): DashboardCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('dashboard context missing');
  return c;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
