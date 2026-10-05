/**
 * Talks to the neovim the TUI runs inside (a toggleterm float sets $NVIM to
 * the parent's RPC socket). `--remote-expr` evaluates without typing keys, so
 * it works whatever mode the float is in.
 *
 * @module nvim
 */
import { execFile } from "node:child_process";

/** The parent nvim's socket, when the TUI runs in a neovim terminal. */
export function parentNvim(): string | null {
  return process.env.NVIM?.trim() || null;
}

/** Opens `command` in a new toggleterm float (a plain :terminal float without toggleterm). */
export function floatTerminalLua(command: string): string {
  return `(function(cmd)
  local ok, terms = pcall(require, 'toggleterm.terminal')
  if ok then
    terms.Terminal:new({ cmd = cmd, direction = 'float', close_on_exit = false }):toggle()
    return 1
  end
  local buf = vim.api.nvim_create_buf(false, true)
  local w = math.floor(vim.o.columns * 0.8)
  local h = math.floor(vim.o.lines * 0.8)
  vim.api.nvim_open_win(buf, true, { relative = 'editor', width = w, height = h,
    row = math.floor((vim.o.lines - h) / 3), col = math.floor((vim.o.columns - w) / 2), border = 'rounded' })
  vim.fn.jobstart(cmd, { term = true })
  vim.cmd('startinsert')
  return 1
end)(${JSON.stringify(command)})`;
}

/** Runs Lua in the parent nvim. Resolves to an error message, or null on success. */
export function runInParentNvim(lua: string): Promise<string | null> {
  const socket = parentNvim();
  if (socket === null) return Promise.resolve("Not running inside neovim.");
  // luaeval keeps the code a single expression for --remote-expr.
  const expr = `luaeval(${JSON.stringify(lua.replace(/\n\s*/g, " "))})`;
  return new Promise((resolve) => {
    execFile(
      "nvim",
      ["--server", socket, "--remote-expr", expr],
      { timeout: 5000 },
      (error, _out, stderr) => resolve(error ? stderr.trim() || error.message : null),
    );
  });
}

/** `tailscale ssh` into `host` with a login shell already in `dir` (a thread's worktree there). */
export function remoteShellCommand(host: string, dir: string): string {
  const quoted = `'${dir.replace(/'/g, `'\\''`)}'`;
  return `tailscale ssh ${host} -t "cd ${quoted} && exec \\$SHELL -l"`;
}
