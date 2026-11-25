import { prKey } from "./pr-url";
import { statusPrefix, type PrStatus } from "./status";

const ENDPOINT = "https://api.github.com/graphql";
const PAGE_SIZE = 100;

const MY_SEARCHES = {
  mine: "is:pr is:open archived:false author:@me",
};

// review-requested drops a PR once I review it; reviewed-by keeps its tab until merge.
const REVIEW_SEARCHES = {
  review: "is:pr is:open archived:false draft:false user-review-requested:@me",
  reviewed:
    "is:pr is:open archived:false draft:false reviewed-by:@me -author:@me",
};

const PR_FIELDS = `
  id url state updatedAt isDraft mergeable mergeStateStatus reviewDecision
`;

const NODES_QUERY = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on PullRequest { ${PR_FIELDS} } }
}`;

function searchQuery(searches: Record<string, string>): string {
  const fields = Object.entries(searches).map(
    ([alias, query]) =>
      `${alias}: search(query: ${JSON.stringify(query)}, type: ISSUE, first: ${PAGE_SIZE}) {
        issueCount
        nodes { ... on PullRequest { ${PR_FIELDS} } }
      }`,
  );
  return `query { viewer { login } ${fields.join("\n")} }`;
}

export interface PullRequest {
  key: string;
  id: string;
  url: string;
  open: boolean;
  updatedAt: string;
  prefix: string;
}

export interface SearchResult {
  login: string;
  prs: PullRequest[];
  /** False when a search hit the page limit, so a missing PR may still be open. */
  complete: boolean;
  /** ISO date, or null when the token has no expiry or GitHub didn't say. */
  tokenExpiresAt: string | null;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs = 0,
    readonly isAuthError = false,
  ) {
    super(message);
  }
}

interface PrNode {
  id: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  updatedAt: string;
  isDraft: boolean;
  mergeable: PrStatus["mergeable"];
  mergeStateStatus: PrStatus["mergeState"];
  reviewDecision: PrStatus["review"];
}

/** Search and `nodes` return `{}` for non-PR items and `null` for missing ones. */
type MaybePrNode = PrNode | Record<string, never> | null;

interface Search {
  issueCount: number;
  nodes: MaybePrNode[];
}

interface GraphQLError {
  type?: string;
  message: string;
  path?: (string | number)[];
}

const noErrorIsIgnorable = () => false;
const isMissingNode = (error: GraphQLError) => error.path?.[0] === "nodes";

export async function searchPullRequests(
  token: string,
  includeReviews: boolean,
): Promise<SearchResult> {
  const searches = includeReviews
    ? { ...MY_SEARCHES, ...REVIEW_SEARCHES }
    : MY_SEARCHES;
  const { data, tokenExpiresAt } = await graphql<
    { viewer: { login: string } } & Record<string, unknown>
  >(token, searchQuery(searches), {}, noErrorIsIgnorable);
  const results = Object.keys(searches).map((alias) => data[alias] as Search);
  const byKey = new Map<string, PullRequest>();
  for (const pr of results.flatMap((search) => toPullRequests(search.nodes))) {
    byKey.set(pr.key, pr);
  }
  return {
    login: data.viewer.login,
    prs: [...byKey.values()],
    complete: results.every(
      (search) => search.issueCount <= search.nodes.length,
    ),
    tokenExpiresAt,
  };
}

/** Current state of specific PRs. PRs that no longer exist or can't be read are left out. */
export async function fetchPullRequests(
  token: string,
  ids: string[],
): Promise<PullRequest[]> {
  const prs: PullRequest[] = [];
  for (let start = 0; start < ids.length; start += PAGE_SIZE) {
    const { data } = await graphql<{ nodes: MaybePrNode[] }>(
      token,
      NODES_QUERY,
      { ids: ids.slice(start, start + PAGE_SIZE) },
      isMissingNode,
    );
    prs.push(...toPullRequests(data.nodes));
  }
  return prs;
}

function toPullRequests(nodes: MaybePrNode[]): PullRequest[] {
  return nodes.flatMap((node) => {
    if (!node || !("id" in node)) return [];
    const key = prKey(node.url);
    if (!key) return [];
    return {
      key,
      id: node.id,
      url: node.url,
      open: node.state === "OPEN",
      updatedAt: node.updatedAt,
      prefix: statusPrefix({
        review: node.reviewDecision,
        mergeable: node.mergeable,
        mergeState: node.mergeStateStatus,
        isDraft: node.isDraft,
      }),
    };
  });
}

async function graphql<T>(
  token: string,
  query: string,
  variables: object,
  isIgnorable: (error: GraphQLError) => boolean,
): Promise<{ data: T; tokenExpiresAt: string | null }> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status === 401) {
    throw new GitHubError(
      "GitHub rejected the token. It may be wrong, expired or revoked.",
      0,
      true,
    );
  }
  const waitMs = rateLimitWait(response);
  if (waitMs) {
    throw new GitHubError("GitHub rate limit reached. Pausing sync.", waitMs);
  }
  if (response.status === 403) {
    throw new GitHubError(
      "GitHub refused access (403). The token may lack permissions or need org approval.",
    );
  }
  if (!response.ok) {
    throw new GitHubError(`GitHub API error ${response.status}.`);
  }

  const body = (await response.json()) as { data?: T; errors?: GraphQLError[] };
  const errors = (body.errors ?? []).filter((error) => !isIgnorable(error));
  if (errors.some((error) => error.type === "RATE_LIMITED")) {
    throw new GitHubError("GitHub rate limit reached. Pausing sync.", 60_000);
  }
  if (errors.length || !body.data) {
    throw new GitHubError(`GitHub: ${errors[0]?.message ?? "empty response"}`);
  }
  return { data: body.data, tokenExpiresAt: tokenExpiry(response) };
}

/** GitHub sends this header for tokens that expire, e.g. "2026-12-01 12:00:00 UTC". */
export function tokenExpiry(response: Response): string | null {
  const header = response.headers.get("github-authentication-token-expiration");
  const time = header ? Date.parse(header) : NaN;
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function rateLimitWait(response: Response): number {
  if (response.status !== 403 && response.status !== 429) return 0;
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  if (retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  if (response.headers.get("x-ratelimit-remaining") !== "0") {
    return response.status === 429 ? 60_000 : 0;
  }
  const resetMs = Number(response.headers.get("x-ratelimit-reset")) * 1000;
  return Math.max(resetMs - Date.now(), 60_000);
}
