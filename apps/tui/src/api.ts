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
  /** Where `cz tui` was started: the list opens scoped to the project containing it. */
  readonly cwd: string;
}

export interface TuiModule {
  readonly runTui: (options: RunTuiOptions) => Promise<void>;
}

/** A machine this terminal has paired with, as `cz --host` reaches it. */
export interface PairedHost {
  readonly label: string;
  readonly environmentId: string;
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  /** False when switched off in the TUI's Hosts tab. */
  readonly enabled: boolean;
}

export interface HostsModule {
  readonly listHosts: (configDir: string) => Promise<ReadonlyArray<PairedHost>>;
  readonly pairHost: (input: {
    readonly configDir: string;
    readonly pairingUrl: string;
    readonly appVersion: string;
  }) => Promise<{ readonly environmentId: string; readonly label: string }>;
}
