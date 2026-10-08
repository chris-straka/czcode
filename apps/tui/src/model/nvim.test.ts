import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  floatTerminalLua,
  passEscapeLua,
  processAncestors,
  remoteShellCommand,
  runInParentNvim,
} from "./nvim.ts";

const hasNvim = (() => {
  try {
    NodeChildProcess.execFileSync("nvim", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasNvim)("runInParentNvim against a headless nvim", () => {
  const dir = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cz-tui-nvim-")),
  );
  const socket = NodePath.join(dir, "nvim.sock");
  let child: ReturnType<typeof NodeChildProcess.spawn>;

  beforeAll(async () => {
    child = NodeChildProcess.spawn("nvim", ["--headless", "--clean", "--listen", socket], {
      stdio: "ignore",
    });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        NodeChildProcess.execFileSync("nvim", ["--server", socket, "--remote-expr", "1"], {
          stdio: "ignore",
        });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });
  afterAll(() => {
    child.kill();
  });

  it("opens a command in a floating terminal (no toggleterm: plain float)", async () => {
    process.env.NVIM = socket;
    expect(await runInParentNvim(floatTerminalLua("echo hi; sleep 5"))).toBeNull();
    const kind = NodeChildProcess.execFileSync("nvim", [
      "--server",
      socket,
      "--remote-expr",
      "nvim_win_get_config(0).relative .. ':' .. &buftype",
    ]).toString();
    expect(kind.trim()).toBe("editor:terminal");
  });

  it("lets Esc through to the TUI's terminal despite a global tnoremap <Esc>", async () => {
    process.env.NVIM = socket;
    const remote = (expr: string) =>
      NodeChildProcess.execFileSync("nvim", ["--server", socket, "--remote-expr", expr])
        .toString()
        .trim();
    remote(`luaeval("vim.keymap.set('t', '<Esc>', [[<C-\\\\><C-n>]])")`);
    remote("execute('enew')");
    const job = Number(remote(`luaeval("vim.fn.jobstart('sleep 30', { term = true })")`));
    expect(job).toBeGreaterThan(0);
    const pid = Number(remote("b:terminal_job_pid"));
    expect(await runInParentNvim(passEscapeLua([pid + 100000, pid]))).toBeNull();
    // The TUI's buffer sends Esc on; the global mapping still applies elsewhere.
    expect(remote(`maparg('<Esc>', 't')`)).toBe("<Esc>");
    remote("execute('enew')");
    expect(remote(`maparg('<Esc>', 't')`)).toBe("<C-\\><C-N>");
  });
});

describe("processAncestors", () => {
  it("walks from a process up through its parents", async () => {
    const chain = await processAncestors(process.pid, 3);
    expect(chain[0]).toBe(process.pid);
    expect(chain[1]).toBe(process.ppid);
  });
});

describe("remoteShellCommand", () => {
  it("quotes the worktree path for the remote shell", () => {
    expect(remoteShellCommand("box", "/home/c/it's here")).toBe(
      `tailscale ssh box -t "cd '/home/c/it'\\''s here' && exec \\$SHELL -l"`,
    );
  });
});
