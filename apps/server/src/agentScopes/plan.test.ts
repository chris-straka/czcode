import { describe, expect, it } from "vite-plus/test";

import { parseProcStat, planScopes, processKey, scopeUnitName, type ProcessEntry } from "./plan.ts";

const SERVER = 100;
const proc = (pid: number, ppid: number, comm = "node"): ProcessEntry => ({
  pid,
  ppid,
  startTime: `${pid}0`,
  comm,
});

describe("agent scopes", () => {
  it("reads pid, parent, start time, and a name with spaces from /proc stat", () => {
    const stat =
      "4242 (opencode serve) S 100 4242 4242 0 -1 4194560 1 0 0 0 5 3 0 0 20 0 12 0 987654 1000 200";
    expect(parseProcStat(stat)).toEqual({
      pid: 4242,
      ppid: 100,
      startTime: "987654",
      comm: "opencode serve",
    });
    expect(parseProcStat("garbage")).toBeNull();
  });

  it("scopes a child with its descendants once it has outlived a sweep, not before", () => {
    const claude = proc(200, SERVER, "claude");
    const bash = proc(201, 200, "bash");
    const cargo = proc(202, 201, "cargo");
    const git = proc(300, SERVER, "git");
    const processes = [proc(SERVER, 1), claude, bash, cargo, git];

    const first = planScopes({
      processes,
      lookup: () => undefined,
      serverPid: SERVER,
      previouslySeen: new Set(),
      scoped: new Map(),
    });
    expect(first.create).toEqual([]);

    const second = planScopes({
      processes,
      lookup: () => undefined,
      serverPid: SERVER,
      previouslySeen: new Set([processKey(claude)]),
      scoped: new Map(),
    });
    expect(second.create).toEqual([{ root: claude, pids: [200, 201, 202] }]);
  });

  it("attaches stragglers of an agent that already has a scope", () => {
    const claude = proc(200, SERVER, "claude");
    const plan = planScopes({
      // claude itself already moved, so only /proc knows it as the parent.
      processes: [proc(SERVER, 1), proc(205, 200, "bash")],
      lookup: (pid) => (pid === 200 ? claude : undefined),
      serverPid: SERVER,
      previouslySeen: new Set(),
      scoped: new Map([[processKey(claude), "cz-agent-200-claude.scope"]]),
    });
    expect(plan.attach).toEqual([{ unit: "cz-agent-200-claude.scope", pids: [205] }]);
  });

  it("names units systemd accepts", () => {
    expect(scopeUnitName({ pid: 7, comm: "opencode serve" })).toBe(
      "cz-agent-7-opencode_serve.scope",
    );
  });
});
