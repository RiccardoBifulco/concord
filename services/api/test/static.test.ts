import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Auth } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { Db } from "../src/db.js";
import { createServerApp } from "../src/main.js";
import { CONTROL_MIGRATIONS } from "../src/schema.js";
import { Tenants, fileStore } from "../src/tenants.js";

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

/** The real server app over a throwaway data dir and a one-file dashboard build. */
function serverApp(publicUrl: string) {
  const dir = mkdtempSync(join(tmpdir(), "concord-headers-"));
  const webDir = join(dir, "web");
  const dataDir = join(dir, "data");
  mkdirSync(webDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(webDir, "index.html"), "<html>shell</html>");

  const config = loadConfig({
    CONCORD_DATA_DIR: dataDir,
    CONCORD_WEB_DIR: webDir,
    CONCORD_SIGNUP: "open",
    CONCORD_PUBLIC_URL: publicUrl,
  });
  const control = new Db(join(dataDir, "control.db"), CONTROL_MIGRATIONS);
  const auth = new Auth(control, { signup: "open" });
  const tenants = new Tenants(fileStore(dataDir), {}, () => false, () => []);
  const runtime = {
    control,
    auth,
    tenants,
    close: () => {
      tenants.close();
      control.close();
    },
  };
  const app = createServerApp(runtime, config);
  return {
    app,
    close() {
      runtime.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("security headers", () => {
  for (const route of ["/", "/api/health"]) {
    it(`sets the baseline headers on ${route}`, async () => {
      const s = serverApp("http://concord.test");
      try {
        const res = await s.app.request(route);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-security-policy")).toBe(CSP);
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("referrer-policy")).toBe("same-origin");
        expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      } finally {
        s.close();
      }
    });

    it(`omits HSTS over http on ${route}`, async () => {
      const s = serverApp("http://concord.test");
      try {
        const res = await s.app.request(route);
        expect(res.headers.get("strict-transport-security")).toBeNull();
      } finally {
        s.close();
      }
    });

    it(`sends HSTS over https on ${route}`, async () => {
      const s = serverApp("https://concord.test");
      try {
        const res = await s.app.request(route);
        expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
        expect(res.headers.get("content-security-policy")).toBe(CSP);
      } finally {
        s.close();
      }
    });
  }
});
