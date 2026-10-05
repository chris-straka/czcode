/**
 * `cz tui`: the terminal client. A window onto the same server as the web,
 * desktop, and mobile apps, sized for a neovim toggleterm float.
 *
 * @module tui
 */
import { RegistryContext } from "@effect/atom-react";
import { render } from "ink";
import { createElement as h } from "react";

import type { RunTuiOptions, TuiModule } from "./api.ts";
import { makeTuiRuntime } from "./runtime/connection.ts";
import { makeTuiAtoms } from "./state/atoms.ts";
import { App } from "./ui/App.ts";

export type { LocalServer, RunTuiOptions } from "./api.ts";

/** Runs the TUI until the user quits. Typed for other packages by entry.d.ts. */
export const runTui: TuiModule["runTui"] = async (options: RunTuiOptions) => {
  const tuiRuntime = makeTuiRuntime(options);
  const atoms = makeTuiAtoms(tuiRuntime);
  const app = render(
    h(
      RegistryContext.Provider,
      { value: tuiRuntime.registry },
      h(App, { atoms, cwd: options.cwd }),
    ),
    {
      exitOnCtrlC: true,
      // Nothing left in the float's scrollback on exit.
      alternateScreen: true,
      // Esc and Alt+letter arrive unambiguously (nvim's terminal speaks the protocol).
      kittyKeyboard: { mode: "enabled", flags: ["disambiguateEscapeCodes"] },
    },
  );
  // Closing the float, nvim, or the Ghostty tab hangs up. Unmount so the caller
  // revokes this session; the terminal may already be gone, so drop write errors.
  const onHangup = () => {
    process.stdout.on("error", () => {});
    app.unmount();
  };
  process.once("SIGHUP", onHangup);
  try {
    await app.waitUntilExit();
  } finally {
    process.off("SIGHUP", onHangup);
    tuiRuntime.registry.dispose();
  }
};
