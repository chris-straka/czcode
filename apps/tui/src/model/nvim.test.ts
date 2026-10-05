import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { floatTerminalLua, remoteShellCommand, runInParentNvim } from "./nvim.ts";

const hasNvim = (() => {
  try {
    execFileSync("nvim", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasNvim)("runInParentNvim against a headless nvim", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cz-tui-nvim-")));
  const socket = join(dir, "nvim.sock");
  let child: ReturnType<typeof spawn>;

  beforeAll(async () => {
    child = spawn("nvim", ["--headless", "--clean", "--listen", socket], { stdio: "ignore" });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        execFileSync("nvim", ["--server", socket, "--remote-expr", "1"], { stdio: "ignore" });
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
    const kind = execFileSync("nvim", [
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
