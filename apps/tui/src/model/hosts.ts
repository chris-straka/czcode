/**
 * Hosts (environments) as the TUI lists them, and the choices a new thread
 * needs on one: its projects and a model. Pure, so the rules are testable.
 *
 * @module hosts
 */
import type { SupervisorConnectionState } from "@cz/client-runtime/connection";
import type {
  ModelSelection,
  OrchestrationProjectShell,
  OrchestrationV2ShellSnapshot,
  ServerConfig,
} from "@cz/contracts";
import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  getProviderOptionDescriptors,
} from "@cz/shared/model";

/** "online", "connecting", "offline", "blocked: <why>": a host's state in a word or two. */
export function hostStateLabel(state: SupervisorConnectionState, enabled: boolean): string {
  if (!enabled) return "off";
  switch (state.phase) {
    case "connected":
      return "online";
    case "connecting":
      return state.stage === "synchronizing" ? "syncing" : "connecting";
    case "backoff":
      return "retrying";
    case "blocked":
      return `blocked${state.lastFailure ? `: ${state.lastFailure.message}` : ""}`;
    case "offline":
      return "offline";
    case "available":
      return "idle";
  }
}

export function liveProjects(
  snapshot: OrchestrationV2ShellSnapshot | null,
): ReadonlyArray<OrchestrationProjectShell> {
  if (snapshot === null) return [];
  return snapshot.projects.toSorted((left, right) => left.title.localeCompare(right.title));
}

/** Every model a host offers, ready providers first, as instance/model pairs. */
export function hostModels(config: Pick<ServerConfig, "providers"> | null): Array<ModelSelection> {
  if (config === null) return [];
  const ready = (status: string) => (status === "ready" ? 0 : 1);
  return config.providers
    .filter((provider) => provider.enabled)
    .toSorted((left, right) => ready(left.status) - ready(right.status))
    .flatMap((provider) =>
      provider.models.map((model) => ({ instanceId: provider.instanceId, model: model.slug })),
    );
}

/**
 * The project's default, then the host's default, then the first ready
 * provider's default model. Saved options the model no longer offers (a "max"
 * variant on a model without one) fall back to its defaults, as the composer
 * does, so the run doesn't fail at the provider.
 */
export function newThreadModel(
  project: Pick<OrchestrationProjectShell, "defaultModelSelection">,
  config: Pick<ServerConfig, "settings" | "providers"> | null,
): ModelSelection | null {
  const saved = project.defaultModelSelection ?? config?.settings.defaultModelSelection ?? null;
  if (saved) return config ? withOfferedOptions(saved, config.providers) : saved;
  if (config === null) return null;
  const provider = config.providers.find(
    (candidate) => candidate.enabled && candidate.models.length > 0,
  );
  const model = provider?.models.find((entry) => entry.isDefault) ?? provider?.models[0];
  return provider && model ? { instanceId: provider.instanceId, model: model.slug } : null;
}

function withOfferedOptions(
  selection: ModelSelection,
  providers: Pick<ServerConfig, "providers">["providers"],
): ModelSelection {
  const caps = providers
    .find((provider) => provider.instanceId === selection.instanceId)
    ?.models.find((model) => model.slug === selection.model)?.capabilities;
  if (!caps || !selection.options?.length) return selection;
  const options = buildExplicitProviderOptionSelectionsFromDescriptors(
    getProviderOptionDescriptors({ caps, selections: selection.options }),
    selection.options,
  );
  const { options: _saved, ...rest } = selection;
  return options ? { ...rest, options } : rest;
}
