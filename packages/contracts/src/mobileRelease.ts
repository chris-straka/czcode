/**
 * App updates served by the owner's own cz server (fork): the newest release
 * APK built on that machine, so the phone updates without a store.
 *
 * @module mobileRelease
 */
import * as Schema from "effect/Schema";

export const AndroidRelease = Schema.Struct({
  version: Schema.String,
  /** Android versionCode; a phone with a lower one should update. */
  versionCode: Schema.Int,
  sizeBytes: Schema.Int,
  /** Signed, short-lived download path on the same server; needs no auth header. */
  url: Schema.String,
});
export type AndroidRelease = typeof AndroidRelease.Type;

export const AndroidReleaseResult = Schema.Struct({ release: Schema.NullOr(AndroidRelease) });
export type AndroidReleaseResult = typeof AndroidReleaseResult.Type;
