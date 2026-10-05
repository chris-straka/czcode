// @effect-diagnostics globalConsole:off -- Runs at module load, before the Effect runtime and its logger exist.
// Imported first by main.ts, before anything reads CZ_* or ~/.cz: adopts
// pre-rename env vars and copies the old data dir to ~/.cz on the first run.
import {
  adoptLegacyEnv,
  LEGACY_HOME_MIGRATED_MESSAGE,
  legacyEnvWarning,
  migrateLegacyHome,
} from "@cz/shared/legacyNames";

const adopted = adoptLegacyEnv();
if (adopted.length > 0) console.warn(legacyEnvWarning(adopted));
if (!process.env.CZ_HOME?.trim() && migrateLegacyHome() === "migrated") {
  console.warn(LEGACY_HOME_MIGRATED_MESSAGE);
}
