// What `import("@cz/tui/hosts")` looks like to other packages' type checks,
// keeping client-runtime's DOM-typed code out of the server's program (as
// entry.d.ts does for the TUI itself).
import type { HostsModule } from "./api.ts";

export type { PairedHost } from "./api.ts";
export declare const listHosts: HostsModule["listHosts"];
export declare const pairHost: HostsModule["pairHost"];
export declare const removeHost: HostsModule["removeHost"];
