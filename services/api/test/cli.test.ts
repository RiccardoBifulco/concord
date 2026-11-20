import { parseArgs } from "node:util";
import { describe, expect, it } from "vitest";
import { suggestFlag, usageErrorMessage } from "../src/cli-usage.js";

const known = ["org", "network", "no-baseline", "json", "help"];
const options = { org: { type: "string" }, json: { type: "boolean" } } as const;

function failure(args: string[]): unknown {
  try {
    parseArgs({ args, options, allowPositionals: true });
  } catch (err) {
    return err;
  }
  throw new Error("expected parseArgs to throw");
}

describe("cli usage errors", () => {
  it("suggests the closest known flag", () => {
    expect(suggestFlag("--netwrk", known)).toBe("--network");
    expect(suggestFlag("--jsn", known)).toBe("--json");
    expect(suggestFlag("--bogus", known)).toBeUndefined();
  });

  it("names an unknown flag, suggests a fix and points at --help", () => {
    const msg = usageErrorMessage(failure(["--jsno", "x"]), known);
    expect(msg).toBe("unknown option '--jsno'. Did you mean '--json'? Run 'concord --help' for usage.");
  });

  it("gives a one-line message without suggestion when nothing is close", () => {
    const msg = usageErrorMessage(failure(["--bogus"]), known)!;
    expect(msg).toBe("unknown option '--bogus'. Run 'concord --help' for usage.");
    expect(msg).not.toContain("\n");
  });

  it("explains a missing value", () => {
    const msg = usageErrorMessage(failure(["--org"]), known)!;
    expect(msg).toContain("'--org'");
    expect(msg).toContain("needs a value");
    expect(msg).toContain("concord --help");
  });

  it("leaves other errors alone", () => {
    expect(usageErrorMessage(new Error("boom"), known)).toBeUndefined();
  });
});
