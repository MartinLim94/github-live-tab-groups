import { describe, expect, it } from "vitest";
import { prKey } from "./pr-url";

describe("prKey", () => {
  it.each([
    ["https://github.com/Acme/Wallet/pull/12", "acme/wallet#12"],
    ["https://github.com/acme/wallet/pull/12/files", "acme/wallet#12"],
    ["https://github.com/acme/wallet/pull/12#discussion_r1", "acme/wallet#12"],
    ["https://github.com/acme/wallet/pull/12?w=1", "acme/wallet#12"],
  ])("reads %s", (url, key) => {
    expect(prKey(url)).toBe(key);
  });

  it.each([
    "https://github.com/acme/wallet/pulls",
    "https://github.com/acme/wallet/pull/12abc",
    "https://github.com/acme/wallet/issues/12",
    "https://gitlab.com/acme/wallet/pull/12",
    "https://evil.com/github.com/acme/wallet/pull/12",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(prKey(url)).toBeNull();
  });
});
