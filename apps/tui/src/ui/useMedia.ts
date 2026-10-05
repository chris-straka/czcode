import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@cz/client-runtime/state/assets";
import type { DecisionMediaRef, EnvironmentId } from "@cz/contracts";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";

import { cachedMedia } from "../model/media.ts";
import type { TuiAtoms } from "../state/atoms.ts";

/** A decision's media file on this machine (downloaded once), or null while it loads. */
export function useMediaFile(
  atoms: TuiAtoms,
  environmentId: EnvironmentId,
  media: DecisionMediaRef | null,
): { readonly path: string | null; readonly error: string | null } {
  const prepared = useAtomValue(atoms.session.preparedConnectionValueAtom(environmentId));
  const base = Option.getOrNull(prepared)?.httpBaseUrl ?? null;
  const [state, setState] = useState<{ key: string; path: string | null; error: string | null }>({
    key: "",
    path: null,
    error: null,
  });
  const key = media?.key ?? "";
  useEffect(() => {
    if (!media?.url || base === null) return;
    let live = true;
    const url = resolveAssetUrl(base, media.url);
    if (url === null) return;
    setState({ key: media.key, path: null, error: null });
    cachedMedia(media.key, url)
      .then((path) => live && setState({ key: media.key, path, error: null }))
      .catch(
        (error: unknown) => live && setState({ key: media.key, path: null, error: String(error) }),
      );
    return () => {
      live = false;
    };
  }, [media?.key, media?.url, base]);
  return state.key === key ? state : { path: null, error: null };
}
