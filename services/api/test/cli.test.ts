import { describe, expect, it } from "vitest";
import { EXIT_BREAKS, EXIT_ERROR, EXIT_OK, exitCodeForRun } from "../src/cli-exit.js";
import { USAGE } from "../src/cli-usage.js";

const run = (...statuses: string[]) => ({ breaks: statuses.map((status) => ({ status })) });

describe("exitCodeForRun", () => {
  it("keeps the three codes distinct", () => {
    expect([EXIT_OK, EXIT_ERROR, EXIT_BREAKS]).toEqual([0, 1, 2]);
  });

  it("exits 0 for a clean run, with or without --fail-on-breaks", () => {
    expect(exitCodeForRun(run(), true)).toBe(EXIT_OK);
    expect(exitCodeForRun(run(), false)).toBe(EXIT_OK);
  });

  it("exits 0 with open breaks when --fail-on-breaks is not set", () => {
    expect(exitCodeForRun(run("open"), false)).toBe(EXIT_OK);
  });

  it("exits 2 when --fail-on-breaks is set and a break is open", () => {
    expect(exitCodeForRun(run("open"), true)).toBe(EXIT_BREAKS);
    expect(exitCodeForRun(run("resolved", "open"), true)).toBe(EXIT_BREAKS);
  });

  it("does not count signed-off breaks as open", () => {
    expect(exitCodeForRun(run("acknowledged", "resolved"), true)).toBe(EXIT_OK);
  });
});

describe("usage text", () => {
  it("documents the flag and the exit codes", () => {
    expect(USAGE).toContain("--fail-on-breaks");
    expect(USAGE).toMatch(/Exit codes: 0 .*; 1 .*; 2 /);
  });
});
