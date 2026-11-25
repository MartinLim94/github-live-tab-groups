import { prKey } from "./pr-url";
import type { Message } from "./state";

let key: string | null = null;
let prefix = "";
let applied = "";

/** Keeps the status prefix on the title, including after GitHub rewrites it. */
function render(): void {
  const currentKey = prKey(location.href);
  if (currentKey !== key) {
    key = currentKey;
    prefix = "";
    if (key) void requestPrefix();
  }
  const title = document.title;
  const base =
    applied && title.startsWith(applied) ? title.slice(applied.length) : title;
  applied = prefix;
  if (title !== prefix + base) document.title = prefix + base;
}

async function requestPrefix(): Promise<void> {
  const requestedKey = key;
  const message: Message = { type: "getPrefix" };
  const response = (await chrome.runtime.sendMessage(message)) as string;
  if (requestedKey !== key) return;
  prefix = response;
  render();
}

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type !== "prefix") return;
  prefix = message.prefix;
  render();
});

new MutationObserver(render).observe(document.head, {
  subtree: true,
  childList: true,
  characterData: true,
});
render();
