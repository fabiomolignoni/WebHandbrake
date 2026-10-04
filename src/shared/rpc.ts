/** Typed messaging between UI surfaces / content scripts and the background (SEC-05). */

import type { Config, Group, LaterItem, PendingChange, Target } from '../engine/types';
import { api } from '../platform/api';
import type {
  ConfigModel,
  DecisionView,
  DiagModel,
  ImportPreview,
  InterventionModel,
  LaterModel,
  Overview,
  PauseOptions,
  PauseRequest,
  PopupModel,
  SaveResult,
  SessionRequest,
  StatsModel,
  TicketAnswer,
  TicketView,
  TickResponse,
} from './models';

export type Granularity = 'domain' | 'host' | 'path' | 'page';

export interface TickRequest {
  url: string;
  /** The page is visible, focused (or playing media when counted) and the user is not idle. */
  active: boolean;
  media: boolean;
  title?: string;
  /** Ask for the localised labels used by the overlay. */
  labels?: boolean;
}

export interface Api {
  'overview.get': { req: Record<string, never>; res: Overview };
  'config.get': { req: Record<string, never>; res: ConfigModel };
  'popup.get': { req: { tabId?: number }; res: PopupModel };
  explain: { req: { url: string; draftGroup?: Group; incognito?: boolean }; res: DecisionView };
  'intervention.get': { req: { url: string }; res: InterventionModel };
  'intervention.left': { req: { url: string; how: 'close' | 'back' | 'later' | 'alternative' }; res: void };

  'config.save': { req: { config: Config }; res: SaveResult };
  'config.addPage': {
    req: { url: string; granularity: Granularity; groupId: string | null; newGroupName?: string };
    res: SaveResult;
  };
  'group.export': { req: { groupId: string }; res: { filename: string; text: string } };

  'ticket.view': { req: { id: string }; res: TicketView | null };
  'ticket.answer': { req: { id: string; answer?: string; minutes?: number }; res: TicketAnswer };
  'ticket.cancel': { req: { id: string }; res: void };
  /** A11Y-05: replaces a code drawn on canvas with an accessible commitment phrase. */
  'ticket.accessible': { req: { id: string }; res: TicketView | null };

  'pause.options': { req: { url?: string; groupId?: string; incognito?: boolean | null }; res: PauseOptions };
  'pause.start': { req: PauseRequest; res: { ticket: TicketView | null; error?: string } };
  'pause.cancel': { req: { grantId?: string; all?: boolean }; res: void };

  'session.start': { req: SessionRequest; res: { id: string } };
  'session.extend': { req: { id: string; minutes: number }; res: void };
  'session.end': {
    req: { id: string };
    res: { ticket: TicketView | null; refused?: string; pending?: PendingChange };
  };
  'budget.forfeit': { req: { groupId: string }; res: void };

  'pending.confirm': { req: { id: string }; res: { ticket: TicketView | null; error?: string } };
  'pending.cancel': { req: { id: string }; res: void };
  'emergency.request': { req: Record<string, never>; res: { readyAt: number } };
  'emergency.cancel': { req: Record<string, never>; res: void };
  'emergency.start': { req: Record<string, never>; res: { ticket: TicketView | null; error?: string } };
  'password.change': { req: { password: string | null }; res: SaveResult };

  'later.add': { req: { url: string; title?: string; groupId?: string }; res: { item: LaterItem } };
  'later.remove': { req: { ids: string[] }; res: void };
  'later.list': { req: Record<string, never>; res: LaterModel };
  'later.open': { req: { ids: string[] }; res: { opened: number } };

  'tabs.close': { req: Record<string, never>; res: void };
  'tabs.reopenBlocked': { req: Record<string, never>; res: { reopened: number } };
  'tabs.open': { req: { url: string }; res: void };
  /** From the intervention page: reopen the blocked URL in the same tab once it is allowed. */
  'tabs.reopen': { req: { url: string }; res: { ok: boolean } };

  'stats.get': { req: { from: string; to: string }; res: StatsModel };
  'stats.export': { req: { format: 'csv' | 'json' }; res: { filename: string; mime: string; text: string } };
  'stats.delete': {
    req: { scope: 'all' | 'range' | 'site'; from?: string; to?: string; host?: string };
    res: void;
  };

  'data.export': { req: { stats: boolean; secrets: boolean }; res: { filename: string; text: string } };
  'data.preview': { req: { text: string; mode: 'merge' | 'replace' }; res: ImportPreview };
  'data.import': { req: { text: string; mode: 'merge' | 'replace' }; res: SaveResult };
  'backups.list': { req: Record<string, never>; res: { at: number; reason: string; groups: number }[] };
  'backups.restore': { req: { at: number }; res: SaveResult };
  'data.reset': { req: Record<string, never>; res: SaveResult };
  'data.usage': {
    req: Record<string, never>;
    res: { keys: { name: string; bytes: number }[]; total: number | null };
  };

  'diag.get': { req: Record<string, never>; res: DiagModel };
  'diag.selftest': { req: Record<string, never>; res: { started: boolean } };
  'diag.report': { req: { includeUrls: boolean }; res: { text: string } };
  'diag.clearLog': { req: Record<string, never>; res: void };
  'permissions.changed': { req: Record<string, never>; res: void };
  'onboarding.done': { req: Record<string, never>; res: void };

  'cs.tick': { req: TickRequest; res: TickResponse };
  'cs.recheck': { req: { url: string; reason: 'bfcache' | 'spa' | 'load' }; res: void };
  'cs.graceDone': { req: { url: string }; res: void };
  'cs.selftestOk': { req: Record<string, never>; res: void };
  'test.url': { req: { url: string }; res: { allowlisted: Target | null } };
}

export type Method = keyof Api;

export interface Envelope<M extends Method = Method> {
  whb: 1;
  method: M;
  args: Api[M]['req'];
}

export class RpcError extends Error {}

export async function call<M extends Method>(method: M, args: Api[M]['req']): Promise<Api[M]['res']> {
  const env: Envelope<M> = { whb: 1, method, args };
  const res = (await api.runtime.sendMessage(env)) as
    | { ok: true; value: Api[M]['res'] }
    | { ok: false; error: string };
  if (!res) throw new RpcError('No response from background');
  if (!res.ok) throw new RpcError(res.error);
  return res.value;
}

/** Broadcast sent by the background to extension pages when something changed. */
export interface ChangedBroadcast {
  whb: 1;
  changed: ('config' | 'state' | 'usage' | 'later')[];
}
