/**
 * The newest Android APK each paired environment offers (built on that
 * machine by `ccez/release/android.sh --publish`).
 *
 * @module state/mobileRelease
 */
import { createMobileReleaseEnvironmentAtoms } from "@cz/client-runtime/state/mobileRelease";

import { connectionAtomRuntime } from "../connection/runtime";

export const mobileReleaseEnvironment = createMobileReleaseEnvironmentAtoms(connectionAtomRuntime);
