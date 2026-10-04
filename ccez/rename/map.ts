// The rename table: every T3 name and what it becomes. Rules run in order
// over file contents and over file paths, so put specific rules before the
// generic token rules at the bottom.

export type Rule = readonly [pattern: RegExp, replacement: string];

export const rules: readonly Rule[] = [
  // Repositories and orgs.
  [/pingdotgg\/t3code/gi, "chris-straka/czcode"],
  [/t3tools\/t3code/gi, "ccez/czcode"],

  // Package scopes.
  [/@t3tools\//g, "@cz/"],
  [/@t3code\//g, "@cz/"],

  // Reverse-DNS ids (bundle ids, Android packages, launchd labels) and the
  // matching source directories.
  [/(?<![A-Za-z0-9.])com\.t3tools\.(?:t3code|T3Code)(?![A-Za-z0-9])/g, "uk.ccez.cz"],
  [/(?<![A-Za-z0-9.])com\.t3tools\./g, "uk.ccez."],
  [/(?<![A-Za-z0-9.])com\/t3tools\/(?:t3code|T3Code)(?![A-Za-z0-9])/g, "uk/ccez/cz"],
  [/(?<![A-Za-z0-9.])com\/t3tools\//g, "uk/ccez/"],

  // Hostnames.
  [/(?<![A-Za-z0-9-])t3\.codes(?![A-Za-z0-9])/g, "cz.ccez.uk"],
  [/(?<![A-Za-z0-9-])t3\.tools(?![A-Za-z0-9])/g, "ccez.uk"],
  [/(?<![A-Za-z0-9-])t3\.chat(?![A-Za-z0-9])/g, "chat.ccez.uk"],

  // Product and org names.
  [/T3 Code/g, "czcode"],
  [/t3 code/gi, "czcode"],
  [/T3CODE_/g, "CZ_"],
  [/T3CODE/g, "CZCODE"],
  [/T3-?Code/g, "Czcode"],
  [/t3-?[cC]ode/g, "czcode"],
  [/T3TOOLS/g, "CCEZ"],
  [/T3Tools/g, "Ccez"],
  [/t3tools/g, "ccez"],

  // SCREAMING_CASE (env vars, constants): T3_FOO, FOO_T3_BAR, FOO_T3.
  [/(?<![A-Za-z0-9])T3_/g, "CZ_"],
  [/(?<=_)T3(?![a-z0-9])/g, "CZ"],

  // Generic tokens. `t3` starting a token: t3, .t3, t3.json, t3-chat,
  // t3_thread_read, t3Home, t3terminal. Never t32 or uint32.
  [/(?<![A-Za-z0-9])t3(?![0-9])/g, "cz"],
  // `T3` inside or starting an identifier: T3ComposerEditor, hasT3Mcp, allT3.
  [/(?<![A-Z0-9])T3(?=[A-Za-z])/g, "Cz"],
  [/(?<=[a-z])T3(?![A-Za-z0-9])/g, "Cz"],
  // `T3` as a word in prose and UI strings.
  [/(?<![A-Za-z0-9])T3(?![A-Za-z0-9])/g, "cz"],
];

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
