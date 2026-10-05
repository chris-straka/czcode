/**
 * The TUI's entry contract, free of client-runtime imports so the server (no
 * DOM types) can type `cz tui` without compiling the whole client.
 *
 * @module api
 */

/** The running server on this machine, with a session minted by `cz tui`. */
export interface LocalServer {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly label: string;
}

export interface RunTuiOptions {
  readonly local: LocalServer | null;
  /** Saved connections live here (mode 600). */
  readonly configDir: string;
  readonly appVersion: string;
}

export interface TuiModule {
  readonly runTui: (options: RunTuiOptions) => Promise<void>;
}
