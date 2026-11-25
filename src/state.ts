import type { Dismissals } from "./reconcile";

export interface KnownPr {
  id: string;
  updatedAt: string;
  prefix: string;
}

export interface SyncReport {
  at: string;
  login?: string;
  count?: number;
  tokenExpiresAt?: string | null;
  error?: string;
}

export interface LocalState {
  token: string;
  known: Record<string, KnownPr>;
  dismissed: Dismissals;
  backoffUntil: number;
  syncMinutes: number;
  includeReviews: boolean;
  /** Id of the last notification shown, so the same alert isn't repeated every sync. */
  lastAlert: string;
  lastSync?: SyncReport;
}

export type Message =
  | { type: "syncNow" }
  | { type: "getPrefix" }
  | { type: "prefix"; prefix: string };

const DEFAULTS: LocalState = {
  token: "",
  known: {},
  dismissed: {},
  backoffUntil: 0,
  syncMinutes: 0.5,
  includeReviews: false,
  lastAlert: "",
};

export async function loadState(): Promise<LocalState> {
  const stored = (await chrome.storage.local.get(null)) as Partial<LocalState>;
  return { ...DEFAULTS, ...stored };
}

export const saveState = (state: Partial<LocalState>) =>
  chrome.storage.local.set(state);
