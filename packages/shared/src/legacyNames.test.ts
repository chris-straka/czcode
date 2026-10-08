// @effect-diagnostics nodeBuiltinImport:off -- Builds a real ~/.t3 tree on disk, including an open WAL database.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { HostProcessPlatform } from "./hostProcess.ts";
import { adoptLegacyEnv, migrateLegacyHome } from "./legacyNames.ts";

describe("adoptLegacyEnv", () => {
  it("copies T3CODE_* to CZ_* without overriding a CZ_* already set", () => {
    const env: NodeJS.ProcessEnv = {
      T3CODE_HOME: "/old/home",
      T3CODE_PORT: "4000",
      CZ_PORT: "5000",
      PATH: "/bin",
    };
    expect(adoptLegacyEnv(env)).toEqual(["T3CODE_HOME"]);
    expect(env.CZ_HOME).toBe("/old/home");
    expect(env.CZ_PORT).toBe("5000");
  });
});

describe("migrateLegacyHome", () => {
  const homes: string[] = [];
  const makeHome = () => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "legacy-home-"));
    homes.push(home);
    return home;
  };
  afterEach(() => {
    for (const home of homes.splice(0)) NodeFS.rmSync(home, { recursive: true, force: true });
  });

  it("copies user data, snapshots open WAL databases, and leaves the old home intact", () => {
    const home = makeHome();
    const old = NodePath.join(home, ".t3");
    NodeFS.mkdirSync(NodePath.join(old, "userdata", "secrets"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(old, "userdata", "logs"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(old, "runtime"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(old, "userdata", "settings.json"), '{"theme":"dark"}');
    NodeFS.writeFileSync(NodePath.join(old, "userdata", "secrets", "key"), "s3cret", {
      mode: 0o600,
    });
    NodeFS.writeFileSync(NodePath.join(old, "userdata", "logs", "server.log"), "log");
    NodeFS.writeFileSync(NodePath.join(old, "userdata", "clerk-tokens.json"), "{}");
    NodeFS.writeFileSync(NodePath.join(old, "runtime", "node"), "binary");

    // A writer keeps the database open in WAL mode with uncheckpointed rows.
    const writer = new NodeSqlite.DatabaseSync(NodePath.join(old, "userdata", "state.sqlite"));
    writer.exec(
      "PRAGMA journal_mode = WAL; CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('kept');",
    );

    expect(migrateLegacyHome(home)).toBe("migrated");
    writer.close();

    const next = NodePath.join(home, ".cz");
    expect(NodeFS.readFileSync(NodePath.join(next, "userdata", "settings.json"), "utf8")).toBe(
      '{"theme":"dark"}',
    );
    const keyMode = NodeFS.statSync(NodePath.join(next, "userdata", "secrets", "key")).mode;
    // Windows has no POSIX permission bits to keep.
    if (HostProcessPlatform.defaultValue() !== "win32") {
      expect(keyMode & 0o777).toBe(0o600);
    }
    const copy = new NodeSqlite.DatabaseSync(NodePath.join(next, "userdata", "state.sqlite"), {
      readOnly: true,
    });
    expect(copy.prepare("SELECT v FROM t").all()).toEqual([{ v: "kept" }]);
    copy.close();
    expect(NodeFS.existsSync(NodePath.join(next, "userdata", "state.sqlite-wal"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(next, "userdata", "logs"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(next, "userdata", "clerk-tokens.json"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(next, "runtime"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(old, "userdata", "settings.json"))).toBe(true);
    expect(NodeFS.readdirSync(home).sort()).toEqual([".cz", ".t3"]);
  });

  it("runs only once, and not at all without an old home", () => {
    const home = makeHome();
    expect(migrateLegacyHome(home)).toBe("none");
    NodeFS.mkdirSync(NodePath.join(home, ".t3", "userdata"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(home, ".t3", "userdata", "settings.json"), "{}");
    expect(migrateLegacyHome(home)).toBe("migrated");
    NodeFS.writeFileSync(
      NodePath.join(home, ".t3", "userdata", "settings.json"),
      '{"changed":true}',
    );
    expect(migrateLegacyHome(home)).toBe("none");
    expect(
      NodeFS.readFileSync(NodePath.join(home, ".cz", "userdata", "settings.json"), "utf8"),
    ).toBe("{}");
  });
});
