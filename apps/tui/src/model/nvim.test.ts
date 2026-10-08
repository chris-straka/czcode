import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { floatTerminalLua, remoteShellCommand, runInParentNvim } from "./nvim.ts";

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
});

describe("remoteShellCommand", () => {
  it("quotes the worktree path for the remote shell", () => {
    expect(remoteShellCommand("box", "/home/c/it's here")).toBe(
      `tailscale ssh box -t "cd '/home/c/it'\\''s here' && exec \\$SHELL -l"`,
    );
  });
});
