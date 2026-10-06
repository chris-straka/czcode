/**
 * Which of the server's child processes go into which agent scope, kept pure
 * for tests. AgentScopesService reads the processes and applies the plan.
 *
 * @module agentScopesPlan
 */

export interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  /** /proc/<pid>/stat starttime: with the pid, identifies a process across pid reuse. */
  readonly startTime: string;
  readonly comm: string;
}

export const processKey = (entry: Pick<ProcessEntry, "pid" | "startTime">) =>
  `${entry.pid}:${entry.startTime}`;

/** The fields of /proc/<pid>/stat this needs; comm sits in parentheses and may hold spaces. */
export function parseProcStat(stat: string): ProcessEntry | null {
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const pid = Number(stat.slice(0, open).trim());
  // After ")": state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt
  // cmajflt utime stime cutime cstime priority nice num_threads itrealvalue starttime
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const ppid = Number(fields[1]);
  const startTime = fields[19];
  if (!Number.isInteger(pid) || !Number.isInteger(ppid) || startTime === undefined) return null;
  return { pid, ppid, startTime, comm: stat.slice(open + 1, close) };
}

export interface ScopePlan {
  /** New scopes, one per agent: its first process and every descendant still here. */
  readonly create: ReadonlyArray<{
    readonly root: ProcessEntry;
    readonly pids: ReadonlyArray<number>;
  }>;
  /** Stragglers of an agent that already has a scope, by unit name. */
  readonly attach: ReadonlyArray<{ readonly unit: string; readonly pids: ReadonlyArray<number> }>;
}

/**
 * Groups the processes left in the server's cgroup by the server child they
 * descend from. A child gets its own scope once it has outlived one sweep, so
 * quick commands (git, rg) stay put; an agent's later children inherit its
 * scope by themselves.
 */
export function planScopes(input: {
  /** The processes still in the server's cgroup. */
  readonly processes: ReadonlyArray<ProcessEntry>;
  /** Any process by pid, including ones already moved to a scope (their parents). */
  readonly lookup: (pid: number) => ProcessEntry | undefined;
  readonly serverPid: number;
  /** Keys of the processes the previous sweep saw. */
  readonly previouslySeen: ReadonlySet<string>;
  /** Root process key → its scope's unit name. */
  readonly scoped: ReadonlyMap<string, string>;
}): ScopePlan {
  const byPid = new Map(input.processes.map((entry) => [entry.pid, entry]));
  const rootOf = (entry: ProcessEntry): ProcessEntry => {
    let current = entry;
    for (let depth = 0; depth < 64; depth++) {
      if (current.ppid === input.serverPid) return current;
      const parent = byPid.get(current.ppid) ?? input.lookup(current.ppid);
      if (!parent || parent.pid === input.serverPid) return current;
      current = parent;
    }
    return current;
  };

  const create = new Map<string, { root: ProcessEntry; pids: Array<number> }>();
  const attach = new Map<string, Array<number>>();
  for (const entry of input.processes) {
    if (entry.pid === input.serverPid) continue;
    const root = rootOf(entry);
    const rootKey = processKey(root);
    const unit = input.scoped.get(rootKey);
    if (unit !== undefined) {
      attach.set(unit, [...(attach.get(unit) ?? []), entry.pid]);
    } else if (input.previouslySeen.has(rootKey)) {
      const group = create.get(rootKey) ?? { root, pids: [] };
      group.pids.push(entry.pid);
      create.set(rootKey, group);
    }
  }
  return {
    create: [...create.values()],
    attach: [...attach].map(([unit, pids]) => ({ unit, pids })),
  };
}

/** A unit name systemd accepts, telling agents apart in `systemctl --user list-units`. */
export function scopeUnitName(root: Pick<ProcessEntry, "pid" | "comm">): string {
  const name = root.comm.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 32) || "agent";
  return `cz-agent-${root.pid}-${name}.scope`;
}
