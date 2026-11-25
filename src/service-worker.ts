import {
  fetchPullRequests,
  GitHubError,
  searchPullRequests,
  type PullRequest,
} from "./github";
import { prKey } from "./pr-url";
import { planSync, type GroupTab } from "./reconcile";
import {
  loadState,
  saveState,
  type KnownPr,
  type LocalState,
  type Message,
} from "./state";

const GROUP_TITLE = "GitHub PRs";
const SYNCING_TITLE = `${GROUP_TITLE} ⟳`;
// SYNCING_TITLE in case the worker stopped mid-sync; the rest are earlier names, renamed on next sync.
const KNOWN_TITLES = new Set([
  GROUP_TITLE,
  SYNCING_TITLE,
  "GitHub",
  "GitHub ⟳",
]);
const GROUP_COLOR = "purple";
const SYNC_ALARM = "sync";
const MAX_NEW_TABS_PER_SYNC = 10;
const AUTH_ALERT = "auth-failed";
const EXPIRY_WARNING_DAYS = 7;
const DAY_MS = 86_400_000;
// A sync often takes well under a second; keep the ⟳ up long enough to notice.
const MIN_INDICATOR_MS = 800;
const PR_TAB_PATTERN = "https://github.com/*/*/pull/*";

// Keeps the token away from content scripts.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

const closingTabIds = new Set<number>();

// Sync runs and dismissal writes share one queue so they never overwrite each other's state.
let queue: Promise<unknown> = Promise.resolve();
function serial(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

let syncQueued = false;
function requestSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  serial(async () => {
    syncQueued = false;
    await syncWithIndicator();
  }).catch((error) => console.error("Sync failed", error));
}

async function syncWithIndicator(): Promise<void> {
  const startedAt = Date.now();
  await setGroupTitle(SYNCING_TITLE);
  try {
    await sync();
  } finally {
    await delay(MIN_INDICATOR_MS - (Date.now() - startedAt));
    await setGroupTitle(GROUP_TITLE);
  }
}

async function sync(): Promise<void> {
  const state = await loadState();
  if (!state.token) {
    await reportError(state, "Add your GitHub token in the extension options.");
    return;
  }
  if (Date.now() < state.backoffUntil) return;

  try {
    await reconcile(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryAfterMs = error instanceof GitHubError ? error.retryAfterMs : 0;
    await reportError(state, message, retryAfterMs);
    if (error instanceof GitHubError && error.isAuthError) {
      await alertOnce(
        state,
        AUTH_ALERT,
        "GitHub rejected your token. It may have expired. Click to add a new one.",
      );
    }
  }
}

async function reconcile(state: LocalState): Promise<void> {
  const { login, prs, complete, tokenExpiresAt } = await searchPullRequests(
    state.token,
    state.includeReviews,
  );
  const groupTabs = await listGroupTabs();
  const plan = planSync(
    prs,
    groupTabs,
    state.dismissed,
    complete,
    MAX_NEW_TABS_PER_SYNC,
  );

  const known: Record<string, KnownPr> = {};
  for (const tab of groupTabs) {
    const previous = state.known[tab.key];
    if (previous) known[tab.key] = previous;
  }
  Object.assign(known, toKnown(prs));

  // Only close a tab once GitHub confirms its PR is merged or closed.
  const unlistedIds = plan.unlisted.flatMap((key) => known[key]?.id ?? []);
  const checked = await fetchPullRequests(state.token, unlistedIds);
  Object.assign(known, toKnown(checked));
  const closedKeys = new Set(
    checked.filter((pr) => !pr.open).map((pr) => pr.key),
  );
  await closeTabs(
    groupTabs.filter((tab) => closedKeys.has(tab.key)).map((tab) => tab.tabId),
  );
  for (const key of closedKeys) delete known[key];

  await openTabs(plan.open);
  await rememberGroupTabs();
  await pushPrefixes(known);
  await saveState({
    known,
    backoffUntil: 0,
    // A working token again: let a future rejection alert again.
    ...(state.lastAlert === AUTH_ALERT && { lastAlert: "" }),
    lastSync: {
      at: new Date().toISOString(),
      login,
      count: prs.length,
      tokenExpiresAt,
    },
  });
  await setBadge(String(prs.length), "#6e40c9");
  await alertIfTokenExpiresSoon(state, tokenExpiresAt);
}

async function alertIfTokenExpiresSoon(
  state: LocalState,
  expiresAt: string | null,
): Promise<void> {
  if (!expiresAt) return;
  const daysLeft = Math.ceil((Date.parse(expiresAt) - Date.now()) / DAY_MS);
  if (daysLeft > EXPIRY_WARNING_DAYS) return;
  await alertOnce(
    state,
    `expiring:${new Date().toDateString()}`,
    `Your GitHub token expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Click to replace it.`,
  );
}

async function alertOnce(
  state: LocalState,
  id: string,
  message: string,
): Promise<void> {
  if (state.lastAlert === id) return;
  await chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "GitHub Live Tab Groups",
    message,
  });
  await saveState({ lastAlert: id });
}

function toKnown(prs: PullRequest[]): Record<string, KnownPr> {
  return Object.fromEntries(
    prs.map((pr) => [
      pr.key,
      { id: pr.id, updatedAt: pr.updatedAt, prefix: pr.prefix },
    ]),
  );
}

async function reportError(
  state: LocalState,
  error: string,
  retryAfterMs = 0,
): Promise<void> {
  await saveState({
    backoffUntil: Date.now() + retryAfterMs,
    lastSync: { ...state.lastSync, at: new Date().toISOString(), error },
  });
  await setBadge("!", "#d1242f");
}

async function setBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function findGroup(): Promise<chrome.tabGroups.TabGroup | undefined> {
  const groups = await chrome.tabGroups.query({});
  return groups.find((group) => KNOWN_TITLES.has(group.title ?? ""));
}

async function setGroupTitle(title: string): Promise<void> {
  const group = await findGroup();
  if (group && group.title !== title) {
    await chrome.tabGroups.update(group.id, { title });
  }
}

async function listGroupTabs(): Promise<GroupTab[]> {
  const group = await findGroup();
  if (!group) return [];
  const tabs = await chrome.tabs.query({ groupId: group.id });
  return tabs.flatMap((tab) => {
    // A tab that is still loading only has a pendingUrl.
    const key = prKey(tab.url || tab.pendingUrl || "");
    return key && tab.id !== undefined ? [{ tabId: tab.id, key }] : [];
  });
}

async function closeTabs(tabIds: number[]): Promise<void> {
  if (!tabIds.length) return;
  for (const tabId of tabIds) closingTabIds.add(tabId);
  await chrome.tabs.remove(tabIds);
}

async function openTabs(prs: PullRequest[]): Promise<void> {
  if (!prs.length) return;
  const group = await findGroup();
  const windowId =
    group?.windowId ??
    (await chrome.windows.getLastFocused({ windowTypes: ["normal"] })).id;

  const tabIds: number[] = [];
  for (const pr of prs) {
    const tab = await chrome.tabs.create({
      url: pr.url,
      windowId,
      active: false,
    });
    if (tab.id !== undefined) tabIds.push(tab.id);
  }
  const [first, ...rest] = tabIds;
  if (first === undefined) return;

  const groupId = await chrome.tabs.group({
    tabIds: [first, ...rest],
    ...(group ? { groupId: group.id } : { createProperties: { windowId } }),
  });
  if (!group) {
    await chrome.tabGroups.update(groupId, {
      title: SYNCING_TITLE,
      color: GROUP_COLOR,
    });
  }
}

/** Lets a later tab close be traced back to its PR, since a closed tab's URL is gone. */
async function rememberGroupTabs(): Promise<void> {
  const tabKeys = Object.fromEntries(
    (await listGroupTabs()).map((tab) => [tab.tabId, tab.key]),
  );
  await chrome.storage.session.set({ tabKeys });
}

async function pushPrefixes(known: Record<string, KnownPr>): Promise<void> {
  const tabs = await chrome.tabs.query({ url: PR_TAB_PATTERN });
  await Promise.all(
    tabs.map((tab) => {
      const prefix = known[prKey(tab.url ?? "") ?? ""]?.prefix;
      if (tab.id === undefined || prefix === undefined) return;
      const message: Message = { type: "prefix", prefix };
      // Tabs that are asleep or still loading have no page script to answer; they ask on load.
      return chrome.tabs.sendMessage(tab.id, message).catch(() => undefined);
    }),
  );
}

async function recordDismissal(tabId: number): Promise<void> {
  const { tabKeys = {} } = (await chrome.storage.session.get("tabKeys")) as {
    tabKeys?: Record<string, string>;
  };
  const key = tabKeys[tabId];
  if (!key) return;
  const { dismissed } = await loadState();
  await saveState({
    dismissed: { ...dismissed, [key]: new Date().toISOString() },
  });
}

async function prefixForUrl(url: string | undefined): Promise<string> {
  const key = prKey(url ?? "");
  if (!key) return "";
  const { known } = await loadState();
  return known[key]?.prefix ?? "";
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(ms, 0)));

const scheduleSync = (minutes: number) =>
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: minutes });

async function start(): Promise<void> {
  const { syncMinutes } = await loadState();
  await scheduleSync(syncMinutes);
  requestSync();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.syncMinutes) return;
  void scheduleSync(changes.syncMinutes.newValue as number);
});

chrome.runtime.onInstalled.addListener(async () => {
  await start();
  const { token } = await loadState();
  if (!token) await chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(start);
chrome.notifications.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) requestSync();
});
chrome.action.onClicked.addListener(requestSync);
chrome.commands.onCommand.addListener((command) => {
  if (command === "sync-now") requestSync();
});

chrome.tabs.onRemoved.addListener((tabId, { isWindowClosing }) => {
  // Closed by this extension or by quitting the browser: not the user dismissing a PR.
  if (closingTabIds.delete(tabId) || isWindowClosing) return;
  serial(() => recordDismissal(tabId)).catch((error) =>
    console.error("Could not record dismissal", error),
  );
});

chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    if (message.type === "syncNow") requestSync();
    if (message.type !== "getPrefix") return;
    prefixForUrl(sender.tab?.url).then(sendResponse);
    return true;
  },
);
