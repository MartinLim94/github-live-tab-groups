import type { PullRequest } from "./github";

export interface GroupTab {
  tabId: number;
  key: string;
}

/** PR key mapped to when the user closed its tab. Those PRs never reopen. */
export type Dismissals = Record<string, string>;

export interface SyncPlan {
  open: PullRequest[];
  /** PR keys with a group tab but missing from the search. Check them before closing. */
  unlisted: string[];
}

export function planSync(
  qualifying: PullRequest[],
  groupTabs: GroupTab[],
  dismissed: Dismissals,
  complete: boolean,
  maxOpen: number,
): SyncPlan {
  const inGroup = new Set(groupTabs.map((tab) => tab.key));
  const current = new Set(qualifying.map((pr) => pr.key));
  return {
    open: qualifying
      .filter((pr) => !inGroup.has(pr.key) && !(pr.key in dismissed))
      .slice(0, maxOpen),
    unlisted: complete ? [...inGroup].filter((key) => !current.has(key)) : [],
  };
}
