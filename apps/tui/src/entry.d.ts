// What `import("@cz/tui")` looks like to other packages' type checks (the
// package's "types" condition). Declaring only the entry keeps client-runtime,
// which needs DOM types, out of the server's program; index.ts checks itself
// against this with `satisfies`.
import type { RunTuiOptions } from "./api.ts";

export type { LocalServer, RunTuiOptions } from "./api.ts";
export declare function runTui(options: RunTuiOptions): Promise<void>;
