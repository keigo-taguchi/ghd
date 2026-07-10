import { describe, expect, it } from "vitest";
import { classifyOutcome, EXIT_CODES } from "../src/errors.js";
import { parseResponse } from "../src/parse.js";
import { ALL_SECTIONS } from "../src/model.js";
import full from "./fixtures/full.json";
import partial from "./fixtures/partial-error.json";
import rateLimited from "./fixtures/rate-limited.json";

const S = (o: unknown) => JSON.stringify(o);

const base = {
  enoent: false,
  timedOut: false,
  exitCode: 0,
  stderr: "",
  parsed: null,
  sections: ALL_SECTIONS,
};

const err = (kind: string) => expect.objectContaining({ kind: "error", error: kind });

describe("classifyOutcome の判定順序", () => {
  it("1. ENOENT → gh_not_found (127)", () => {
    expect(classifyOutcome({ ...base, enoent: true })).toEqual(err("gh_not_found"));
    expect(EXIT_CODES.gh_not_found).toBe(127);
  });

  it("2. unknown command → gh_too_old", () => {
    expect(
      classifyOutcome({ ...base, exitCode: 1, stderr: 'unknown command "graphql"' }),
    ).toEqual(err("gh_too_old"));
  });

  it("3. タイムアウト → timeout (5)", () => {
    expect(classifyOutcome({ ...base, timedOut: true, exitCode: null })).toEqual(
      err("timeout"),
    );
    expect(EXIT_CODES.timeout).toBe(5);
  });

  it("4. 部分エラー: data+errors 併存で1セクションでも取れていれば render", () => {
    const parsed = parseResponse(S(partial), ALL_SECTIONS);
    const o = classifyOutcome({ ...base, exitCode: 1, stderr: "GraphQL error", parsed });
    expect(o.kind).toBe("render");
  });

  it("4b. gh exit 0 の正常系ももちろん render", () => {
    const parsed = parseResponse(S(full), ALL_SECTIONS);
    expect(classifyOutcome({ ...base, parsed }).kind).toBe("render");
  });

  it("5. RATE_LIMITED（data 実質なし）→ rate_limited (6)", () => {
    const parsed = parseResponse(S(rateLimited), ALL_SECTIONS);
    expect(classifyOutcome({ ...base, exitCode: 1, parsed })).toEqual(
      err("rate_limited"),
    );
    expect(EXIT_CODES.rate_limited).toBe(6);
  });

  it("6. 未認証は多重シグナル（exit 4 / gh auth login / HTTP 401）", () => {
    expect(classifyOutcome({ ...base, exitCode: 4 })).toEqual(err("unauthenticated"));
    expect(
      classifyOutcome({
        ...base,
        exitCode: 1,
        stderr: "To get started with GitHub CLI, please run:  gh auth login",
      }),
    ).toEqual(err("unauthenticated"));
    expect(
      classifyOutcome({ ...base, exitCode: 1, stderr: "gh: HTTP 401 Bad credentials" }),
    ).toEqual(err("unauthenticated"));
  });

  it("7. SAML → saml (3)", () => {
    expect(
      classifyOutcome({
        ...base,
        exitCode: 1,
        stderr: "Resource protected by organization SAML enforcement.",
      }),
    ).toEqual(err("saml"));
  });

  it("8. HTTP 403 / FORBIDDEN 全滅 → forbidden (3)", () => {
    expect(
      classifyOutcome({ ...base, exitCode: 1, stderr: "gh: HTTP 403 Forbidden" }),
    ).toEqual(err("forbidden"));
  });

  it("9. ネットワーク断 → network (4)", () => {
    for (const msg of [
      "dial tcp: lookup api.github.com: getaddrinfo ENOTFOUND",
      "read tcp: ECONNRESET",
      "error connecting to api.github.com",
    ]) {
      expect(classifyOutcome({ ...base, exitCode: 1, stderr: msg })).toEqual(
        err("network"),
      );
    }
  });

  it("10. その他 → unknown、stderr の先頭行を detail に添える", () => {
    const o = classifyOutcome({ ...base, exitCode: 1, stderr: "something exploded\nmore" });
    expect(o).toEqual(err("unknown"));
    if (o.kind === "error") expect(o.detail).toBe("something exploded");
  });

  it("優先順位: ENOENT は stderr の内容より優先される", () => {
    expect(
      classifyOutcome({ ...base, enoent: true, stderr: "gh auth login" }),
    ).toEqual(err("gh_not_found"));
  });
});
