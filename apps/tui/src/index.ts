/**
 * `cz tui`: the terminal client. A window onto the same server as the web,
 * desktop, and mobile apps, sized for a neovim toggleterm float.
 *
 * @module tui
 */
import { RegistryContext } from "@effect/atom-react";
import { render } from "ink";
import { createElement as h } from "react";

import { makeTuiRuntime, type TuiRuntimeOptions } from "./runtime/connection.ts";
import { makeTuiAtoms } from "./state/atoms.ts";
import { App } from "./ui/App.ts";

export type { LocalServer } from "./runtime/platform.ts";
export type RunTuiOptions = TuiRuntimeOptions;

/** Runs the TUI until the user quits. */
export async function runTui(options: RunTuiOptions): Promise<void> {
  const tuiRuntime = makeTuiRuntime(options);
  const atoms = makeTuiAtoms(tuiRuntime);
  const app = render(
    h(RegistryContext.Provider, { value: tuiRuntime.registry }, h(App, { atoms })),
    { exitOnCtrlC: true },
  );
  await app.waitUntilExit();
  tuiRuntime.registry.dispose();
}
