import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Auth } from "../src/auth.js";
import { Db } from "../src/db.js";
import { CONTROL_MIGRATIONS } from "../src/schema.js";
import { Tenants, fileStore } from "../src/tenants.js";
import { Client, FAST, FakeChain, PASSPHRASE, at, harness, key, u } from "./helpers.js";

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(API, "src", "cli.ts");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "concord-cli-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const env = () => ({ ...process.env, CONCORD_DATA_DIR: dir, CONCORD_ORG: "", CONCORD_SIGNUP: "open" });

/** Run the real CLI in its own process. stdin is not a terminal, so no prompt is possible. */
function cli(...args: string[]) {
  const r = spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], { cwd: API, env: env(), encoding: "utf8", input: "" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** A workspace with one watched asset and one register, written through the real services. */
async function seed(): Promise<string> {
  const control = new Db(join(dir, "control.db"), CONTROL_MIGRATIONS);
  const auth = new Auth(control, { signup: "open", cost: FAST });
  const chain = new FakeChain();
  const tenants = new Tenants(fileStore(dir), { testnet: { passphrase: PASSPHRASE, chain } }, (id) => auth.orgExists(id), () => auth.orgIds());
  const { orgId } = await auth.signUp({ email: "ops@example.test", name: "Ops", password: "correct horse battery", orgName: "Acme" });
  const ws = tenants.forOrg(orgId);
  const asset = await ws.watchAsset({ network: "testnet", asset: `FUND:${key()}`, fromLedger: 1 });
  ws.importRegister(asset.id, { csv: `holder_id,account,units\nA,${key()},1\n`, asOf: at(40) });
  tenants.close();
  control.close();
  return orgId;
}

// Each case starts a few real CLI processes, which is slow on a busy machine.
describe("destructive CLI commands", { timeout: 30_000 }, () => {
  it("org-delete without --yes deletes nothing and exits 1", async () => {
    const orgId = await seed();
    const r = cli("org-delete", orgId);
    expect(r.code).toBe(1);
    expect(r.out).toContain("1 assets, 0 events, 1 registers, 0 runs, 0 notes");
    expect(r.err).toContain("--yes");
    expect(cli("orgs").out).toContain(orgId);
  });

  it("org-delete --dry-run prints counts, deletes nothing, exits 0", async () => {
    const orgId = await seed();
    const r = cli("org-delete", orgId, "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toContain("would delete");
    expect(r.out).not.toContain("deleted Acme");
    expect(cli("orgs").out).toContain(orgId);
  });

  it("org-delete --yes deletes the workspace", async () => {
    const orgId = await seed();
    const r = cli("org-delete", orgId, "--yes");
    expect(r.code).toBe(0);
    expect(r.out).toContain(`deleted Acme (${orgId})`);
    expect(cli("orgs").out).not.toContain(orgId);
  });

  it("unwatch without --yes keeps the asset; --dry-run keeps it too; --yes removes it", async () => {
    const orgId = await seed();
    const refused = cli("unwatch", "FUND", "--org", orgId);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("--yes");
    expect(cli("assets", "--org", orgId, "--json").out).toContain("FUND");

    const dry = cli("unwatch", "FUND", "--org", orgId, "--dry-run");
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("would delete asset FUND");
    expect(cli("assets", "--org", orgId).out).toContain("FUND");

    const done = cli("unwatch", "FUND", "--org", orgId, "--yes");
    expect(done.code).toBe(0);
    expect(cli("assets", "--org", orgId).out).toContain("(none)");
  });
});

describe("Concord.deletionCounts", () => {
  it("matches the rows in the database, per asset and per workspace", async () => {
    const h = harness();
    const client = await new Client(h.app).signUp("counts@example.test", "Counts");
    const ws = h.tenants.forOrg(client.orgId);
    const [h1, h2] = [key(), key()];
    const fund = await ws.watchAsset({ network: "testnet", asset: `FUND:${key()}`, fromLedger: 1 });
    await ws.watchAsset({ network: "testnet", asset: `OTHER:${key()}`, fromLedger: 1 });
    h.chain.push(fund.id, "mint", 3, { to: h1, amount: u(100) });
    h.chain.push(fund.id, "mint", 3, { to: h2, amount: u(50) });
    await ws.sync("FUND");
    const reg = ws.importRegister("FUND", { csv: `holder_id,account,units\nA,${h1},90\n`, asOf: at(40) });
    const run = await ws.reconcile("FUND", reg.registerId);
    ws.setNote("FUND", "recon", run.breaks[0]!.key, { fingerprint: run.breaks[0]!.fingerprint, status: "resolved", note: "ok" });

    const n = (table: string) => ws.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
    expect(ws.deletionCounts("FUND")).toEqual({ assets: 1, events: 2, registers: 1, runs: 1, notes: 1 });
    expect(ws.deletionCounts()).toEqual({ assets: 2, events: n("events"), registers: n("registers"), runs: n("runs"), notes: n("break_notes") });
    expect(() => ws.deletionCounts("NOPE")).toThrow(/not watched/);
  });
});
