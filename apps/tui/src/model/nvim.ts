/**
 * Talks to the neovim the TUI runs inside (a toggleterm float sets $NVIM to
 * the parent's RPC socket). `--remote-expr` evaluates without typing keys, so
 * it works whatever mode the float is in.
 *
 * @module nvim
 */
import * as NodeChildProcess from "node:child_process";

/** The parent nvim's socket, when the TUI runs in a neovim terminal. */
export function parentNvim(): string | null {
  return process.env.NVIM?.trim() || null;
}

/**
 * Opens `command` in a new toggleterm float (a plain :terminal float without
 * toggleterm). One float shows at a time, so open ones (this TUI's included)
 * are hidden first, and the float closes when the command exits.
 */
export function floatTerminalLua(command: string): string {
  return `(function(cmd)
  local ok, terms = pcall(require, 'toggleterm.terminal')
  if ok then
    for _, other in ipairs(terms.get_all(true)) do
      if other:is_open() and other.direction == 'float' then other:close() end
    end
    terms.Terminal:new({ cmd = cmd, direction = 'float', close_on_exit = true }):toggle()
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

/**
 * Lua giving the TUI its own Esc. A common terminal-mode mapping (toggleterm's
 * suggested `tnoremap <Esc> <C-\\><C-n>`) makes nvim take Esc before the
 * program sees it, so "back" never arrives. This maps Esc to itself, buffer
 * local, in the terminal whose job is one of `pids` (the TUI or a shell
 * above it), leaving the mapping alone everywhere else. Returns how many
 * buffers it mapped.
 */
export function passEscapeLua(pids: ReadonlyArray<number>): string {
  return `(function(pids)
  local wanted = {}
  for _, pid in ipairs(pids) do wanted[pid] = true end
  local mapped = 0
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    local ok, job = pcall(vim.api.nvim_buf_get_var, buf, 'terminal_job_pid')
    if ok and wanted[job] then
      vim.keymap.set('t', '<Esc>', '<Esc>', { buffer = buf, nowait = true })
      mapped = mapped + 1
    end
  end
  return mapped
end)({${pids.map((pid) => Math.trunc(pid)).join(", ")}})`;
}

/** `pid` and its ancestors (nearest first), up to `depth`, via `ps` (Linux and macOS). */
export async function processAncestors(pid: number, depth = 8): Promise<Array<number>> {
  const chain = [pid];
  let current = pid;
  for (let step = 0; step < depth; step++) {
    const parent = await new Promise<number | null>((resolve) =>
      NodeChildProcess.execFile(
        "ps",
        ["-o", "ppid=", "-p", String(current)],
        { timeout: 2000 },
        (error, out) => resolve(error ? null : Number(out.trim()) || null),
      ),
    );
    if (parent === null || parent <= 1) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

/** Runs Lua in the parent nvim. Resolves to an error message, or null on success. */
export function runInParentNvim(lua: string): Promise<string | null> {
  const socket = parentNvim();
  if (socket === null) return Promise.resolve("Not running inside neovim.");
  // luaeval keeps the code a single expression for --remote-expr.
  const expr = `luaeval(${JSON.stringify(lua.replace(/\n\s*/g, " "))})`;
  return new Promise((resolve) => {
    NodeChildProcess.execFile(
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
