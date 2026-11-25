import { describe, expect, it } from "vitest";
import { statusPrefix, type PrStatus } from "./status";

const base: PrStatus = {
  review: null,
  mergeable: "MERGEABLE",
  mergeState: "BLOCKED",
  isDraft: false,
};

describe("statusPrefix", () => {
  it("is empty when there is nothing to show", () => {
    expect(statusPrefix(base)).toBe("");
  });

  it("orders review, conflict, draft", () => {
    expect(
      statusPrefix({
        review: "CHANGES_REQUESTED",
        mergeable: "CONFLICTING",
        mergeState: "DIRTY",
        isDraft: true,
      }),
    ).toBe("✋⚠️📝 ");
  });

  it.each([
    ["APPROVED", "👍 "],
    ["CHANGES_REQUESTED", "✋ "],
  ] as const)("maps review %s", (review, prefix) => {
    expect(statusPrefix({ ...base, review })).toBe(prefix);
  });

  it("shows nothing while a review is still pending", () => {
    expect(statusPrefix({ ...base, review: "REVIEW_REQUIRED" })).toBe("");
  });

  it("ignores an unknown merge state", () => {
    expect(statusPrefix({ ...base, mergeable: "UNKNOWN" })).toBe("");
  });

  it.each(["CLEAN", "HAS_HOOKS"] as const)(
    "shows 🚀 instead of 👍 when ready to merge (%s)",
    (mergeState) => {
      expect(statusPrefix({ ...base, review: "APPROVED", mergeState })).toBe(
        "🚀 ",
      );
    },
  );

  it.each(["BLOCKED", "BEHIND", "UNSTABLE", "UNKNOWN"] as const)(
    "is not ready to merge when %s",
    (mergeState) => {
      expect(statusPrefix({ ...base, review: "APPROVED", mergeState })).toBe(
        "👍 ",
      );
    },
  );
});
