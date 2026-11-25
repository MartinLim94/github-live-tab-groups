const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

/** Stable PR identity like "owner/repo#123", or null when the URL is not a github.com PR page. */
export function prKey(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const { hostname, pathname } = new URL(url);
  const match = hostname === "github.com" ? PR_PATH.exec(pathname) : null;
  return match ? `${match[1]}/${match[2]}#${match[3]}`.toLowerCase() : null;
}
