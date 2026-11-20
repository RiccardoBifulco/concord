import { beforeEach, describe, expect, it } from "vitest";
import { USAGE, registerDeletedMessage, registerRows } from "../src/cli-usage.js";
import { Concord, NotFound } from "../src/concord.js";
import { Db } from "../src/db.js";
import { FakeChain, PASSPHRASE, at, key, u } from "./helpers.js";

describe("registers and register-delete", () => {
  let concord: Concord;
  const issuer = key();
  const [h1, h2] = [key(), key()];
  const csv = `holder_id,account,units\nA,${h1},90\nB,${h2},50\nC,${h2},oops\n`;

  beforeEach(async () => {
    const chain = new FakeChain();
    concord = new Concord(new Db(":memory:"), { testnet: { passphrase: PASSPHRASE, chain } });
    const asset = await concord.watchAsset({ network: "testnet", asset: `FUND:${issuer}`, fromLedger: 1 });
    chain.push(asset.id, "mint", 3, { to: h1, amount: u(100) });
    await concord.sync("FUND");
  });

  it("lists id, as-of, source, positions, rejected rows and importer, newest first", () => {
    const actor = { id: "cli", label: "cli:tester" };
    concord.importRegister("FUND", { csv, asOf: at(10), source: "old.csv" }, actor);
    concord.importRegister("FUND", { csv, asOf: at(40), source: "new.csv" });
    expect(registerRows(concord.registers("FUND"))).toEqual([
      { id: 2, asOf: at(40), source: "new.csv", positions: 2, rejectedRows: 1, importer: "" },
      { id: 1, asOf: at(10), source: "old.csv", positions: 2, rejectedRows: 1, importer: "cli:tester" },
    ]);
  });

  it("lists nothing for an asset with no registers", () => {
    expect(registerRows(concord.registers("FUND"))).toEqual([]);
  });

  it("returns how many runs went with a deleted register", async () => {
    const reg = concord.importRegister("FUND", { csv, asOf: at(40), source: "a.csv" });
    await concord.reconcile("FUND", reg.registerId);
    await concord.reconcile("FUND", reg.registerId);
    const keep = concord.importRegister("FUND", { csv, asOf: at(50), source: "b.csv" });
    await concord.reconcile("FUND", keep.registerId);

    const runs = concord.deleteRegister("FUND", reg.registerId);
    expect(runs).toBe(2);
    expect(registerDeletedMessage(reg.registerId, runs)).toBe(`deleted register ${reg.registerId} and 2 reconciliation runs`);
    expect(concord.registers("FUND").map((r) => r.id)).toEqual([keep.registerId]);
    expect(concord.latestRunForRegister(keep.registerId)).toBeDefined();
  });

  it("reports zero runs, singular wording, and rejects an unknown register", () => {
    const reg = concord.importRegister("FUND", { csv, asOf: at(40) });
    expect(concord.deleteRegister("FUND", reg.registerId)).toBe(0);
    expect(registerDeletedMessage(1, 1)).toBe("deleted register 1 and 1 reconciliation run");
    expect(() => concord.deleteRegister("FUND", 999)).toThrow(new NotFound("no such register for this asset"));
  });

  it("documents both commands in the usage text", () => {
    expect(USAGE).toContain("registers ASSET");
    expect(USAGE).toContain("register-delete ASSET ID");
    expect(USAGE).toContain("--yes");
  });
});
