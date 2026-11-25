import { describe, expect, it } from "vitest";
import type { PullRequest } from "./github";
import { planSync } from "./reconcile";

const pr = (key: string, updatedAt = "t1"): PullRequest => ({
  key,
  id: `id-${key}`,
  url: `https://github.com/${key.replace("#", "/pull/")}`,
  open: true,
  updatedAt,
  prefix: "",
});

const tab = (tabId: number, key: string) => ({ tabId, key });

describe("planSync", () => {
  it("opens tabs only for PRs not already in the group", () => {
    const plan = planSync(
      [pr("a/b#1"), pr("a/b#2")],
      [tab(10, "a/b#1")],
      {},
      true,
      10,
    );
    expect(plan.open.map((p) => p.key)).toEqual(["a/b#2"]);
  });

  it("opens nothing on a repeat sync", () => {
    const plan = planSync([pr("a/b#1")], [tab(10, "a/b#1")], {}, true, 10);
    expect(plan.open).toEqual([]);
    expect(plan.unlisted).toEqual([]);
  });

  it("limits how many tabs open in one sync", () => {
    const prs = ["a/b#1", "a/b#2", "a/b#3"].map((key) => pr(key));
    expect(planSync(prs, [], {}, true, 2).open).toHaveLength(2);
  });

  it("lists group tabs missing from a complete search for checking", () => {
    const plan = planSync(
      [pr("a/b#1")],
      [tab(10, "a/b#1"), tab(11, "a/b#9")],
      {},
      true,
      10,
    );
    expect(plan.unlisted).toEqual(["a/b#9"]);
  });

  it("lists nothing for checking when the search was incomplete", () => {
    const plan = planSync([], [tab(11, "a/b#9")], {}, false, 10);
    expect(plan.unlisted).toEqual([]);
  });

  it("lists a PR once even when two group tabs show it", () => {
    const plan = planSync(
      [],
      [tab(10, "a/b#9"), tab(11, "a/b#9")],
      {},
      true,
      10,
    );
    expect(plan.unlisted).toEqual(["a/b#9"]);
  });

  it("never reopens a closed PR, even after it changes", () => {
    const dismissed = { "a/b#1": "2026-11-25T00:00:00Z" };
    const plan = planSync(
      [pr("a/b#1", "t2"), pr("a/b#2")],
      [],
      dismissed,
      true,
      10,
    );
    expect(plan.open.map((p) => p.key)).toEqual(["a/b#2"]);
  });
});
