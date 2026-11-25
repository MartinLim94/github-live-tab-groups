// No CI symbol: GitHub's own tab icon already shows CI status.
export interface PrStatus {
  review: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeState:
    | "BEHIND"
    | "BLOCKED"
    | "CLEAN"
    | "DIRTY"
    | "DRAFT"
    | "HAS_HOOKS"
    | "UNKNOWN"
    | "UNSTABLE";
  isDraft: boolean;
}

const REVIEW_SYMBOL: Partial<Record<NonNullable<PrStatus["review"]>, string>> =
  {
    APPROVED: "👍",
    CHANGES_REQUESTED: "✋",
  };

// GitHub's CLEAN: required reviews done, checks pass, no conflicts.
const READY_TO_MERGE = new Set<PrStatus["mergeState"]>(["CLEAN", "HAS_HOOKS"]);

/** Emoji shown in front of the PR tab title, e.g. "✋⚠️ ". Empty when there is nothing to show. */
export function statusPrefix(status: PrStatus): string {
  const symbols = [
    READY_TO_MERGE.has(status.mergeState)
      ? "🚀"
      : status.review && REVIEW_SYMBOL[status.review],
    status.mergeable === "CONFLICTING" && "⚠️",
    status.isDraft && "📝",
  ].filter(Boolean);
  return symbols.length ? `${symbols.join("")} ` : "";
}
