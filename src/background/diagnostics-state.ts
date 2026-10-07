/** In-memory diagnostics: performance counters and the decision log ring buffer (DIA-01). */

import { DECISION_LOG_SIZE } from '../engine/limits';
import type { InterventionType } from '../engine/types';
import { sessionStore } from '../platform/api';
import type { DecisionLogEntry } from '../shared/models';

export const counters = {
  ticks: 0,
  compiles: 0,
  enforcements: 0,
  reconciles: 0,
  messages: 0,
  wakeups: 0,
};

let log: DecisionLogEntry[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function ensure() {
  if (!log) log = (await sessionStore.get<DecisionLogEntry[]>('decisionLog')) ?? [];
  return log;
}

export async function logDecision(
  enabled: boolean,
  where: DecisionLogEntry['where'],
  url: string,
  intervention: InterventionType,
  group?: string,
) {
  if (!enabled) return;
  const l = await ensure();
  l.push({ at: Date.now(), where, url, intervention, group });
  if (l.length > DECISION_LOG_SIZE) l.splice(0, l.length - DECISION_LOG_SIZE);
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void sessionStore.set('decisionLog', log);
    }, 2000);
  }
}

export async function getLog(): Promise<DecisionLogEntry[]> {
  return [...(await ensure())];
}

export async function clearLog() {
  log = [];
  await sessionStore.set('decisionLog', []);
}
