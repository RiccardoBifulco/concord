import { afterEach, describe, expect, it } from "vitest";
import { Db } from "../src/db.js";

const open: Db[] = [];

function memory(): Db {
  const db = new Db(":memory:", ["CREATE TABLE x (a INTEGER);"]);
  open.push(db);
  return db;
}

function count(db: Db): number {
  return Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM x")!.n);
}

afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

describe("Db.tx", () => {
  it("commits and returns the value on success", () => {
    const db = memory();
    const out = db.tx(() => {
      db.write("INSERT INTO x (a) VALUES (1)");
      db.write("INSERT INTO x (a) VALUES (2)");
      return "done";
    });
    expect(out).toBe("done");
    expect(count(db)).toBe(2);
  });

  it("rolls back and rethrows the original error when the callback throws", () => {
    const db = memory();
    const boom = new Error("boom");
    let caught: unknown;
    try {
      db.tx(() => {
        db.write("INSERT INTO x (a) VALUES (1)");
        throw boom;
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);
    expect(count(db)).toBe(0);
  });

  it("refuses a nested transaction and still rolls back the outer one", () => {
    const db = memory();
    let caught: unknown;
    try {
      db.tx(() => {
        db.write("INSERT INTO x (a) VALUES (1)");
        db.tx(() => {
          db.write("INSERT INTO x (a) VALUES (2)");
        });
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/cannot start a transaction within a transaction/);
    expect(count(db)).toBe(0);
  });

  it("starts a fresh transaction after a rollback", () => {
    const db = memory();
    expect(() =>
      db.tx(() => {
        db.write("INSERT INTO x (a) VALUES (1)");
        throw new Error("first fails");
      }),
    ).toThrow("first fails");
    expect(count(db)).toBe(0);
    db.tx(() => {
      db.write("INSERT INTO x (a) VALUES (3)");
    });
    expect(count(db)).toBe(1);
  });
});
