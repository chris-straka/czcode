// The rename table: every T3 name and what it becomes. Rules run in order
// over file contents and over file paths, so put specific rules before the
// generic token rules at the bottom.

export type Rule = readonly [pattern: RegExp, replacement: string];

// czcode's identity. Every name below is derived from these, so changing one
// here and re-running the codemod changes it everywhere.
export const identity = {
  /** App name where the OS needs one (launcher, window title, bundle name). */
  app: "czcode",
  /** CLI, server, data dir (~/.cz), env prefix (CZ_), short name in prose. */
  cli: "cz",
  /** GitHub owner and org name; the desktop update feed is owner/app. */
  owner: "chris-straka",
  org: "ccez",
  /** Reverse-DNS prefix for bundle ids and Android packages. */
  reverseDns: "uk.ccez",
  /** Domain standing in for T3's hosted domains (nothing is served there). */
  domain: "ccez.uk",
} as const;

const { app, cli, owner, org, reverseDns, domain } = identity;
const App = app[0]!.toUpperCase() + app.slice(1);
const Cli = cli[0]!.toUpperCase() + cli.slice(1);
const CLI = cli.toUpperCase();
const ORG = org.toUpperCase();
const Org = org[0]!.toUpperCase() + org.slice(1);
const bundleId = `${reverseDns}.${cli}`;

export const rules: readonly Rule[] = [
  // Repositories and orgs.
  [/pingdotgg/gi, owner],
  [/t3tools\/t3code/gi, `${org}/${app}`],

  // Package scopes.
  [/@t3tools\//g, `@${cli}/`],
  [/@t3code\//g, `@${cli}/`],
  [/@t3code(?![A-Za-z0-9-])/g, `@${cli}`],

  // Reverse-DNS ids (bundle ids, Android packages, launchd labels) and the
  // matching source directories.
  [/(?<![A-Za-z0-9])com\.t3tools\.(?:t3code|T3Code)(?![A-Za-z0-9])/g, bundleId],
  [/(?<![A-Za-z0-9])com\.t3tools\./g, `${reverseDns}.`],
  [
    /(?<![A-Za-z0-9.])com\/t3tools\/(?:t3code|T3Code)(?![A-Za-z0-9])/g,
    bundleId.replaceAll(".", "/"),
  ],
  [/(?<![A-Za-z0-9.])com\/t3tools\//g, `${reverseDns.replaceAll(".", "/")}/`],

  // Hostnames.
  [/(?<![A-Za-z0-9-])t3\.codes(?![A-Za-z0-9])/g, `${cli}.${domain}`],
  [/(?<![A-Za-z0-9-])t3\.tools(?![A-Za-z0-9])/g, domain],
  [/(?<![A-Za-z0-9-])t3\.chat(?![A-Za-z0-9])/g, `chat.${domain}`],

  // Product and org names.
  [/T3(?: |\+|%20)Code/g, app],
  [/T3CODE_/g, `${CLI}_`],
  [/T3CODE/g, app.toUpperCase()],
  [/T3[-_]?Code/g, App],
  [/t3[-_ ]?code/gi, app],
  [/T3TOOLS/g, ORG],
  [/T3Tools/g, Org],
  [/t3tools/g, org],

  // SCREAMING_CASE (env vars, constants): T3_FOO, FOO_T3_BAR, FOO_T3.
  [/(?<![A-Za-z0-9])T3_/g, `${CLI}_`],
  [/(?<=_)T3(?![a-z0-9])/g, CLI],

  // Generic tokens. A token starts after a non-alphanumeric, a \n, \r, or \t
  // escape inside a string, or a %XX URL escape. `t3` starting a token: t3,
  // .t3, t3.json, t3-chat, t3_thread_read, t3Home, t3terminal. Never t32 or
  // uint32.
  [/(?:(?<![A-Za-z0-9])|(?<=\\[nrt]|%[0-9A-F]{2}))t3(?![0-9])/g, cli],
  // `T3` inside or starting an identifier: T3ComposerEditor, hasT3Mcp, allT3.
  [/(?<![A-Z0-9])T3(?=[A-Za-z])/g, Cli],
  // `T3` as a word in prose and UI strings (also right after a \n escape).
  [/(?:(?<![A-Za-z0-9])|(?<=\\[nrt]|%[0-9A-F]{2}))T3(?![A-Za-z0-9])/g, cli],
  [/(?<=[a-z])T3(?![A-Za-z0-9])/g, Cli],
];

// Names compiled into vendored binaries, patched byte for byte. Each pair must
// keep its length so offsets and length prefixes stay valid.
export const binaryRules: readonly (readonly [from: string, to: string])[] = [
  // Import in the libghostty write-pty trampoline (ghostty-write-pty.wasm),
  // built from ghostty-write-pty.zig, which the text rules rename.
  ["t3_write_pty", `${cli}_write_pty`],
];
for (const [from, to] of binaryRules) {
  if (from.length !== to.length) throw new Error(`binary rule ${from} -> ${to} changes length`);
}

// Paths the codemod never reads or rewrites. Everything under ccez/ is
// fork material that talks about the rename itself.
export const skipPrefixes: readonly string[] = [".repos/", "ccez/"];
export const skipFiles: readonly string[] = [
  "LICENSE",
  "NOTICE",
  // Reads the pre-rename names (T3CODE_* env vars, ~/.t3, t3.json) once, to
  // migrate them. See the file for why each one is there.
  "packages/shared/src/legacyNames.ts",
  "packages/shared/src/legacyNames.test.ts",
];

// Upstream paths main has deleted. A sync keeps them deleted when upstream
// edits them (see sync.sh).
export const droppedPaths: readonly string[] = ["apps/marketing"];
