# GitHub Live Tab Groups

A Chromium browser extension that keeps a **GitHub PRs** tab group in sync with your open pull requests. Each PR gets one real browser tab. New PRs open automatically, and tabs close once their PR is merged or closed.

Works in Chrome, Dia and other Chromium browsers that support the `chrome.tabGroups` API.

> Not affiliated with or endorsed by GitHub.

## Features

- One tab per open PR you authored, in a tab group named **GitHub PRs**
- Optional: also PRs that request your review (kept until merged)
- Tabs close only after GitHub confirms the PR is merged or closed, never because a request failed
- Close a PR tab yourself and it stays closed
- Status emoji in front of each tab title:

  | Emoji | Meaning                                             |
  | ----- | --------------------------------------------------- |
  | 🚀    | Ready to merge (required reviews done, checks pass) |
  | 👍    | Approved                                            |
  | ✋    | Changes requested                                   |
  | ⚠️    | Merge conflict                                      |
  | 📝    | Draft                                               |

  CI status is not repeated: GitHub's own tab icon already shows it.

- Auto sync every 30 seconds to 5 minutes. The group title shows `⟳` while syncing.
- Sync now: settings page button, toolbar icon, or <kbd>Option</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>)
- Notification when the token is rejected or expires within 7 days

## Install (from source)

Requires Node.js 20+.

```sh
git clone https://github.com/MartinLim94/github-live-tab-groups.git
cd github-live-tab-groups
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist` folder.
3. The settings page opens. Add a GitHub token (see below) and click **Save and sync**.

## GitHub token

The extension calls the official GitHub GraphQL API with a personal access token. Pick one:

**Classic token**: no admin approval, covers every organisation you belong to.

1. Create one at <https://github.com/settings/tokens/new?scopes=repo> with the `repo` scope.
2. If your organisation uses SSO, click **Configure SSO** next to the token and authorise the organisation.

`repo` also grants write access. The extension only reads.

**Fine-grained token**: read-only, but covers one owner (user or organisation).

1. Create one at <https://github.com/settings/personal-access-tokens/new>.
2. Resource owner: the organisation that owns your repositories. Repository access: All repositories.
3. Repository permissions: **Pull requests: Read-only**.

Organisations may require an admin to approve fine-grained tokens. Until then, that organisation's PRs don't appear and sync reports 0 PRs without an error.

## Privacy

- The token is stored in the extension's local storage on your device and is hidden from web pages.
- It is sent only to `https://api.github.com`. There is no backend and no analytics.

## Limitations

- **Dia pinned groups**: Dia hides pinned tab groups and their sleeping tabs from extensions. Keep the group unpinned, or the extension creates a new group.
- Only tabs inside the group are managed. A PR tab you drag out of the group is left alone, and a new one opens in the group.
- Tabs that are asleep or still loading get their status emoji once they load.
- Up to 100 PRs per search. Above that, tabs are never closed for missing PRs.

## Development

```sh
npm test           # unit tests
npm run typecheck  # TypeScript
npm run check      # typecheck, format check, tests and build
```

After a change, run `npm run build` and click reload on the extension card in `chrome://extensions`.

## License

[MIT](LICENSE)
