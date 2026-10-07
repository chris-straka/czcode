// @effect-diagnostics nodeBuiltinImport:off - a plain function the desktop main process and the CLI call outside Effect.
/**
 * czcode's per-user config directory: `$XDG_CONFIG_HOME/czcode`, else
 * `~/.config/czcode` (on macOS too, where the terminal app has always kept it).
 * The computer's shared machine list lives here, so every app on the computer
 * (terminal, desktop, CLI, the local server) must resolve the same path.
 * `CZ_CONFIG_DIR` overrides it, for tests and development builds.
 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export function czConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CZ_CONFIG_DIR?.trim();
  if (explicit) return explicit;
  const base = env.XDG_CONFIG_HOME?.trim() || NodePath.join(NodeOS.homedir(), ".config");
  return NodePath.join(base, "czcode");
}
