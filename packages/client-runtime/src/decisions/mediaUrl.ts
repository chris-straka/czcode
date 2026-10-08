/**
 * Decision media URLs that stay put. The server signs a fresh URL on every
 * list fetch; handing that to a playing `<audio>` reloads it and stops the
 * sound. A media item keeps its first URL until it nears expiry.
 *
 * @module mediaUrl
 */
import type { DecisionMediaRef } from "@cz/contracts";

import { resolveAssetUrl } from "../state/assets.ts";

/** Swap a URL for a fresh one this long before it expires. */
const RENEW_BEFORE_MS = 10 * 60_000;
const cache = new Map<string, { readonly url: string; readonly expiresAt: number }>();

/** The media's loadable URL on its host, the same one for as long as it stays valid. */
export function decisionMediaUrl(
  httpBaseUrl: string,
  media: DecisionMediaRef | null | undefined,
  now: number,
): string | null {
  if (!media?.url) return null;
  const id = `${httpBaseUrl}\u0000${media.key}`;
  const cached = cache.get(id);
  if (cached && cached.expiresAt - RENEW_BEFORE_MS > now) return cached.url;
  const url = resolveAssetUrl(httpBaseUrl, media.url);
  if (url === null) return null;
  const expiresAt = Number(new URL(url, "http://local").searchParams.get("exp"));
  cache.set(id, { url, expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : now });
  return url;
}
