import { loadState, saveState, type Message, type SyncReport } from "./state";

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const tokenInput = byId<HTMLInputElement>("token");
const status = byId<HTMLDListElement>("status");
const syncMinutesSelect = byId<HTMLSelectElement>("sync-minutes");
const includeReviewsCheckbox = byId<HTMLInputElement>("include-reviews");

const SYNC_MINUTE_CHOICES = [0.5, 1, 2, 3, 4, 5];

const syncLabel = (minutes: number) =>
  minutes < 1
    ? `${minutes * 60} seconds`
    : `${minutes} minute${minutes === 1 ? "" : "s"}`;

syncMinutesSelect.replaceChildren(
  ...SYNC_MINUTE_CHOICES.map(
    (minutes) => new Option(syncLabel(minutes), String(minutes)),
  ),
);

function requestSync(): void {
  const message: Message = { type: "syncNow" };
  void chrome.runtime.sendMessage(message);
}

type TokenType = "classic" | "fine-grained";

const PLACEHOLDER: Record<TokenType, string> = {
  classic: "ghp_…",
  "fine-grained": "github_pat_…",
};

let hasToken = false;
let tokenType: TokenType = "classic";

const typeOfToken = (token: string): TokenType =>
  token.startsWith("github_pat_") ? "fine-grained" : "classic";

function rememberToken(token: string | undefined): void {
  hasToken = Boolean(token);
  if (token) tokenType = typeOfToken(token);
}

function showToken(): void {
  byId<HTMLInputElement>(`token-type-${tokenType}`).checked = true;
  for (const section of document.querySelectorAll<HTMLElement>(
    "[data-token-type]",
  )) {
    section.hidden = section.dataset.tokenType !== tokenType;
  }
  tokenInput.placeholder = hasToken
    ? "Token saved. Paste a new one to replace it."
    : PLACEHOLDER[tokenType];
}

function showStatus(report: SyncReport | undefined): void {
  if (!report) {
    status.replaceChildren(row("Last sync", "Not synced yet"));
    return;
  }
  status.replaceChildren(
    row("Signed in as", report.login ?? "—"),
    row("Last checked", new Date(report.at).toLocaleTimeString()),
    row("Open PRs", report.count === undefined ? "—" : String(report.count)),
    row(
      "Token expires",
      report.tokenExpiresAt
        ? new Date(report.tokenExpiresAt).toLocaleDateString()
        : "—",
    ),
    row("Error", report.error ?? "None", Boolean(report.error)),
  );
}

function row(label: string, value: string, isError = false): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  dd.classList.toggle("error", isError);
  fragment.append(dt, dd);
  return fragment;
}

byId("save").addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  await saveState({ token, backoffUntil: 0 });
  tokenInput.value = "";
  requestSync();
});

byId("remove").addEventListener("click", async () => {
  await chrome.storage.local.remove("token");
  requestSync();
});

byId("reopen").addEventListener("click", async () => {
  await saveState({ dismissed: {} });
  requestSync();
});

const syncNowButton = byId<HTMLButtonElement>("sync-now");
let syncTimeout: ReturnType<typeof setTimeout> | undefined;

function showSyncDone(): void {
  clearTimeout(syncTimeout);
  syncNowButton.disabled = false;
  syncNowButton.textContent = "Sync now";
}

syncNowButton.addEventListener("click", () => {
  syncNowButton.disabled = true;
  syncNowButton.textContent = "Syncing…";
  // A sync paused by a rate limit reports nothing, so don't wait forever.
  syncTimeout = setTimeout(showSyncDone, 10_000);
  requestSync();
});

includeReviewsCheckbox.addEventListener("change", async () => {
  await saveState({ includeReviews: includeReviewsCheckbox.checked });
  requestSync();
});

syncMinutesSelect.addEventListener("change", () => {
  void saveState({ syncMinutes: Number(syncMinutesSelect.value) });
});

byId("token-type").addEventListener("change", (event) => {
  tokenType = (event.target as HTMLInputElement).value as TokenType;
  showToken();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.token) {
    rememberToken(changes.token.newValue as string | undefined);
    showToken();
  }
  if (changes.lastSync) {
    showStatus(changes.lastSync.newValue as SyncReport);
    showSyncDone();
  }
});

void loadState().then((state) => {
  rememberToken(state.token);
  showToken();
  syncMinutesSelect.value = String(state.syncMinutes);
  includeReviewsCheckbox.checked = state.includeReviews;
  showStatus(state.lastSync);
});
