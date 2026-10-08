import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@cz/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@cz/client-runtime/state/runtime";

export type ProviderUpdateCandidate = ServerProvider & {
  readonly versionAdvisory: NonNullable<ServerProvider["versionAdvisory"]> & {
    readonly status: "behind_latest";
    readonly latestVersion: string;
  };
};

export type ProviderSettingsUpdateCandidate = ServerProvider & {
  readonly versionAdvisory: NonNullable<ServerProvider["versionAdvisory"]> & {
    readonly canUpdate: true;
    readonly updateCommand: string;
  };
};

export type ProviderUpdateSidebarPillTone = "loading" | "warning" | "error" | "success";

export interface ProviderUpdateSidebarPillView {
  readonly key: string;
  readonly tone: ProviderUpdateSidebarPillTone;
  readonly title: string;
  readonly description: string;
  readonly dismissible?: boolean;
  readonly dismissAfterVisibleMs?: number;
}

interface ProviderUpdateSidebarPillOptions {
  readonly visibleAfterIso?: string;
  readonly dismissedKeys?: ReadonlySet<string>;
}

const PROVIDER_UPDATE_SUCCESS_VISIBLE_MS = 3_000;

function formatVersion(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function chooseRepresentativeProvider(
  current: ServerProvider | undefined,
  candidate: ServerProvider,
): ServerProvider {
  if (!current) {
    return candidate;
  }
  const defaultInstanceId = defaultInstanceIdForDriver(candidate.driver);
  if (candidate.instanceId === defaultInstanceId) {
    return candidate;
  }
  if (current.instanceId === defaultInstanceId) {
    return current;
  }
  return candidate.checkedAt.localeCompare(current.checkedAt) >= 0 ? candidate : current;
}

function dedupeProvidersByDriver<T extends ServerProvider>(providers: ReadonlyArray<T>): T[] {
  const latestProviderByDriver = new Map<ProviderDriverKind, T>();

  for (const provider of providers) {
    latestProviderByDriver.set(
      provider.driver,
      chooseRepresentativeProvider(latestProviderByDriver.get(provider.driver), provider) as T,
    );
  }

  return [...latestProviderByDriver.values()];
}

function getProviderUpdatedTitle(provider: Pick<ServerProvider, "driver" | "version">): string {
  const providerName = PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
  return provider.version
    ? `${providerName} updated: ${formatVersion(provider.version)}`
    : `${providerName} updated`;
}

function getProviderUpdatedDescription(providerCount: number): string {
  return providerCount === 1
    ? "New sessions will use the updated provider."
    : "New sessions will use the updated providers.";
}

function getProviderFailedUpdateTitle(
  provider: Pick<ServerProvider, "driver" | "versionAdvisory">,
): string {
  const providerName = PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
  const attemptedVersion = provider.versionAdvisory?.latestVersion;
  return attemptedVersion
    ? `${providerName} ${formatVersion(attemptedVersion)} update failed`
    : `${providerName} update failed`;
}

export function isProviderUpdateCandidate(
  provider: ServerProvider,
): provider is ProviderUpdateCandidate {
  return (
    provider.enabled &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "broken" &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "unsupported" &&
    provider.versionAdvisory?.status === "behind_latest" &&
    provider.versionAdvisory.latestVersion !== null
  );
}

export function isProviderUpdateActive(provider: Pick<ServerProvider, "updateState">): boolean {
  return provider.updateState?.status === "queued" || provider.updateState?.status === "running";
}

export function collectProviderUpdateCandidates(
  providers: ReadonlyArray<ServerProvider>,
): ProviderUpdateCandidate[] {
  return dedupeProvidersByDriver(providers.filter(isProviderUpdateCandidate));
}

export function isProviderSettingsUpdateCandidate(
  provider: ServerProvider,
): provider is ProviderSettingsUpdateCandidate {
  return (
    provider.enabled &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "broken" &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "unsupported" &&
    provider.versionAdvisory?.status === "behind_latest" &&
    provider.versionAdvisory.canUpdate === true &&
    provider.versionAdvisory.updateCommand !== null
  );
}

export function hasOneClickUpdateProviderCandidate(
  candidate: ProviderUpdateCandidate,
  providers: ReadonlyArray<ServerProvider>,
): boolean {
  if (
    candidate.versionAdvisory.canUpdate !== true ||
    candidate.versionAdvisory.updateCommand === null
  ) {
    return false;
  }

  const driverProviders = providers.filter((provider) => provider.driver === candidate.driver);
  if (driverProviders.length === 0) {
    return false;
  }

  const updateCommands = new Set<string>();
  for (const provider of driverProviders) {
    if (!isProviderUpdateCandidate(provider)) {
      continue;
    }
    const advisory = provider.versionAdvisory;
    if (!advisory || advisory.canUpdate !== true || advisory.updateCommand === null) {
      return false;
    }
    updateCommands.add(advisory.updateCommand);
  }

  return updateCommands.size === 1;
}

export function canOneClickUpdateProviderCandidate(
  candidate: ProviderUpdateCandidate,
  providers: ReadonlyArray<ServerProvider>,
): boolean {
  return (
    !isProviderUpdateActive(candidate) && hasOneClickUpdateProviderCandidate(candidate, providers)
  );
}

export function providerUpdateNotificationKey(
  providers: ReadonlyArray<ProviderUpdateCandidate>,
): string | null {
  const parts = dedupeProvidersByDriver(providers)
    .map((provider) => {
      const advisory = provider.versionAdvisory;
      return [provider.driver, advisory.latestVersion].join(":");
    })
    .toSorted();

  return parts.length > 0 ? parts.join("|") : null;
}

function formatProviderList(providers: ReadonlyArray<Pick<ServerProvider, "driver">>) {
  const names = providers.map(
    (provider) => PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver,
  );
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function getUpdateFinishedAt(provider: ServerProvider): string | null {
  return provider.updateState?.finishedAt ?? null;
}

function isRecentTerminalProvider(
  provider: ServerProvider,
  visibleAfterIso: string | undefined,
): boolean {
  const status = provider.updateState?.status;
  if (status !== "failed" && status !== "unchanged" && status !== "succeeded") {
    return false;
  }
  if (visibleAfterIso === undefined) {
    return true;
  }
  const finishedAt = getUpdateFinishedAt(provider);
  return finishedAt !== null && finishedAt >= visibleAfterIso;
}

function latestFinishedAtForProviders(providers: ReadonlyArray<ServerProvider>): string | null {
  return providers.reduce<string | null>((latest, provider) => {
    const finishedAt = getUpdateFinishedAt(provider);
    if (finishedAt === null) {
      return latest;
    }
    return latest === null || finishedAt > latest ? finishedAt : latest;
  }, null);
}

export function getProviderUpdateSidebarPillView(
  providers: ReadonlyArray<ServerProvider>,
  options?: ProviderUpdateSidebarPillOptions,
): ProviderUpdateSidebarPillView | null {
  const dedupedProviders = dedupeProvidersByDriver(providers);
  const activeProviders = dedupedProviders.filter(isProviderUpdateActive);
  if (activeProviders.length > 0) {
    const activeProvider = activeProviders[0]!;
    const activeProviderName =
      PROVIDER_DISPLAY_NAMES[activeProvider.driver] ?? activeProvider.driver;
    return {
      key: `loading:${activeProviders
        .map((provider) => `${provider.driver}:${provider.updateState?.status ?? "idle"}`)
        .toSorted()
        .join("|")}`,
      tone: "loading",
      title:
        activeProviders.length === 1
          ? `Updating ${activeProviderName}`
          : `Updating ${activeProviders.length} providers`,
      description:
        activeProviders.length === 1
          ? `${formatProviderList(activeProviders)} update in progress.`
          : `${formatProviderList(activeProviders)} updates are in progress.`,
    };
  }

  const recentTerminalProviders = dedupedProviders.filter((provider) =>
    isRecentTerminalProvider(provider, options?.visibleAfterIso),
  );
  const terminalCandidates: ProviderUpdateSidebarPillView[] = [];

  const failedProviders = recentTerminalProviders.filter(
    (provider) => provider.updateState?.status === "failed",
  );
  if (failedProviders.length > 0) {
    const failedProvider = failedProviders[0]!;
    terminalCandidates.push({
      key: `failed:${failedProviders
        .map(
          (provider) =>
            `${provider.driver}:${provider.updateState?.finishedAt ?? "pending"}:${provider.updateState?.message ?? ""}`,
        )
        .toSorted()
        .join("|")}`,
      tone: "error",
      title:
        failedProviders.length === 1
          ? getProviderFailedUpdateTitle(failedProvider)
          : `${failedProviders.length} provider updates failed`,
      description: getFailedProviderUpdateDescription(failedProviders),
      dismissible: true,
    });
  }

  const unchangedProviders = recentTerminalProviders.filter(
    (provider) => provider.updateState?.status === "unchanged",
  );
  if (unchangedProviders.length > 0) {
    const unchangedProvider = unchangedProviders[0]!;
    const unchangedProviderName =
      PROVIDER_DISPLAY_NAMES[unchangedProvider.driver] ?? unchangedProvider.driver;
    terminalCandidates.push({
      key: `unchanged:${unchangedProviders
        .map(
          (provider) =>
            `${provider.driver}:${provider.updateState?.finishedAt ?? "pending"}:${provider.updateState?.message ?? ""}`,
        )
        .toSorted()
        .join("|")}`,
      tone: "warning",
      title:
        unchangedProviders.length === 1
          ? `${unchangedProviderName} still needs an update`
          : `${unchangedProviders.length} providers still need updates`,
      description: `${formatProviderList(unchangedProviders)} ${
        unchangedProviders.length === 1 ? "still appears" : "still appear"
      } outdated. Review provider settings for details.`,
      dismissible: true,
    });
  }

  const succeededProviders = recentTerminalProviders.filter(
    (provider) => provider.updateState?.status === "succeeded",
  );
  if (succeededProviders.length > 0) {
    const succeededProvider = succeededProviders[0]!;
    terminalCandidates.push({
      key: `succeeded:${succeededProviders
        .map(
          (provider) =>
            `${provider.driver}:${provider.updateState?.finishedAt ?? "pending"}:${provider.updateState?.message ?? ""}`,
        )
        .toSorted()
        .join("|")}`,
      tone: "success",
      title:
        succeededProviders.length === 1
          ? getProviderUpdatedTitle(succeededProvider)
          : `${succeededProviders.length} providers updated`,
      description: getProviderUpdatedDescription(succeededProviders.length),
      dismissAfterVisibleMs: PROVIDER_UPDATE_SUCCESS_VISIBLE_MS,
    });
  }

  return (
    terminalCandidates
      .toSorted((left, right) => {
        const leftProviders =
          left.tone === "error"
            ? failedProviders
            : left.tone === "warning"
              ? unchangedProviders
              : succeededProviders;
        const rightProviders =
          right.tone === "error"
            ? failedProviders
            : right.tone === "warning"
              ? unchangedProviders
              : succeededProviders;
        const leftFinishedAt = latestFinishedAtForProviders(leftProviders) ?? "";
        const rightFinishedAt = latestFinishedAtForProviders(rightProviders) ?? "";
        return rightFinishedAt.localeCompare(leftFinishedAt);
      })
      .find((candidate) => !options?.dismissedKeys?.has(candidate.key)) ?? null
  );
}

/** The notice's title, e.g. "Update Available: OpenCode v2.0.26". */
export function getProviderUpdateNoticeTitle(
  providers: ReadonlyArray<ProviderUpdateCandidate>,
): string {
  if (providers.length === 1) {
    const provider = providers[0]!;
    const providerName = PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
    return `Update Available: ${providerName} ${formatVersion(provider.versionAdvisory.latestVersion)}`;
  }
  return `Updates Available: ${providers.length} providers`;
}

function getFailedProviderUpdateDescription(providers: ReadonlyArray<ServerProvider>): string {
  if (providers.length === 1) {
    const provider = providers[0]!;
    if (provider.updateState?.message) {
      return provider.updateState.message;
    }
  }
  return `${formatProviderList(providers)} failed to update. Check provider settings for details.`;
}

// ===========================================================================
// Updating every machine
//
// The launch notice and Providers > All machines > Update all both send each
// outdated provider's update to the machine that has it, all at once, and
// report one line per update. These helpers are pure; the dispatch runs
// through the `serverEnvironment.updateProvider` atom command.
// ===========================================================================

/** A connected machine with at least one outdated, one-click-updatable provider. */
export interface ProviderUpdateMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly candidates: ReadonlyArray<ProviderUpdateCandidate>;
}

export function collectProviderUpdateMachines(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly connected: boolean;
    readonly providers: ReadonlyArray<ServerProvider>;
  }>,
): ProviderUpdateMachine[] {
  return environments.flatMap((environment) => {
    if (!environment.connected) {
      return [];
    }
    const candidates = collectProviderUpdateCandidates(environment.providers).filter((candidate) =>
      canOneClickUpdateProviderCandidate(candidate, environment.providers),
    );
    return candidates.length > 0
      ? [{ environmentId: environment.environmentId, label: environment.label, candidates }]
      : [];
  });
}

/**
 * Key over the provider versions on offer, so the notice shows once per new
 * release rather than again each time another machine connects behind.
 */
export function providerUpdateNoticeKey(
  machines: ReadonlyArray<ProviderUpdateMachine>,
): string | null {
  return providerUpdateNotificationKey(machines.flatMap((machine) => machine.candidates));
}

/** One provider update sent to one machine; `result` is null while it runs. */
export interface ProviderUpdateRun {
  readonly machineLabel: string;
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  /** The version before the update, to say what changed. */
  readonly fromVersion: string | null;
  readonly result: AtomCommandResult<
    { readonly providers: ReadonlyArray<ServerProvider> },
    unknown
  > | null;
}

export function providerUpdateRunsFor(
  machines: ReadonlyArray<ProviderUpdateMachine>,
): ProviderUpdateRun[] {
  return machines.flatMap((machine) =>
    machine.candidates.map((candidate) => ({
      machineLabel: machine.label,
      driver: candidate.driver,
      instanceId: candidate.instanceId,
      fromVersion: candidate.version,
      result: null,
    })),
  );
}

/**
 * Says why an update failed in words the owner can act on. The installer's
 * output carries the real cause (an exit code alone says nothing), so the
 * common npm failures are recognized there.
 */
export function describeProviderUpdateFailure(input: {
  readonly message: string | null | undefined;
  readonly output?: string | null | undefined;
}): string {
  const text = `${input.message ?? ""}\n${input.output ?? ""}`;
  if (/\b(EACCES|EPERM)\b/.test(text)) {
    return /_cacache|[/\\]\.npm\b|npm-cache|cache folder/i.test(text)
      ? "npm can't write its cache"
      : "the installer can't write to its install folder";
  }
  if (/\bENOSPC\b/.test(text)) {
    return "the disk is full";
  }
  if (/\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b/.test(text)) {
    return "it couldn't reach the package registry";
  }
  if (/timed out/i.test(input.message ?? "")) {
    return "the update timed out";
  }
  if (/command not found|not recognized as|\bENOENT\b/i.test(text)) {
    return "the installer isn't on that machine";
  }
  const message = input.message?.trim().replace(/\.$/, "");
  return message ? message : "the update failed";
}

export type ProviderUpdateRunRowState = "running" | "updated" | "failed";

export interface ProviderUpdateRunRow {
  readonly key: string;
  readonly state: ProviderUpdateRunRowState;
  readonly text: string;
}

/**
 * One row per update, in the order they were sent: still running, what
 * changed, or why it failed. Interrupted updates are left out. The provider is
 * named only when the run spans more than one provider.
 */
export function getProviderUpdateRunRows(
  runs: ReadonlyArray<ProviderUpdateRun>,
): ProviderUpdateRunRow[] {
  const nameProvider = new Set(runs.map((run) => run.driver)).size > 1;
  return runs.flatMap((run): ProviderUpdateRunRow[] => {
    const providerName = PROVIDER_DISPLAY_NAMES[run.driver] ?? run.driver;
    const key = `${run.machineLabel}:${run.instanceId}`;
    const label = nameProvider ? `${run.machineLabel} · ${providerName}` : run.machineLabel;
    if (run.result === null) {
      return [{ key, state: "running", text: `${label}: updating…` }];
    }
    if (isAtomCommandInterrupted(run.result)) {
      return [];
    }
    if (run.result._tag === "Failure") {
      const error = squashAtomCommandFailure(run.result);
      const reason = describeProviderUpdateFailure({
        message: error instanceof Error ? error.message : undefined,
      });
      return [{ key, state: "failed", text: `${label}: ${reason}` }];
    }
    const updated = run.result.value.providers.find(
      (provider) => provider.instanceId === run.instanceId,
    );
    const updateState = updated?.updateState;
    if (updateState?.status === "succeeded") {
      const from = run.fromVersion ? `${formatVersion(run.fromVersion)} → ` : "";
      const change = updated?.version
        ? `${providerName} ${from}${formatVersion(updated.version)}`
        : `${providerName} updated`;
      return [{ key, state: "updated", text: `${run.machineLabel}: ${change}` }];
    }
    const reason =
      updateState?.status === "unchanged"
        ? `the update ran, but ${providerName} still reports ${
            updated?.version ? formatVersion(updated.version) : "the old version"
          }`
        : updateState?.status === "failed"
          ? describeProviderUpdateFailure(updateState)
          : "the update didn't finish";
    return [{ key, state: "failed", text: `${label}: ${reason}` }];
  });
}

/**
 * The finished run's headline, or null while updates are still running or
 * when every one was interrupted.
 */
export function getProviderUpdateRunSummary(
  runs: ReadonlyArray<ProviderUpdateRun>,
): { readonly type: "success" | "error"; readonly title: string } | null {
  const rows = getProviderUpdateRunRows(runs);
  if (rows.length === 0 || rows.some((row) => row.state === "running")) {
    return null;
  }
  const updated = rows.filter((row) => row.state === "updated").length;
  const type = updated === rows.length ? "success" : "error";
  const drivers = [...new Set(runs.map((run) => run.driver))];
  if (drivers.length > 1) {
    const updates = (count: number) =>
      count === 1 ? "1 provider update" : `${count} provider updates`;
    return {
      type,
      title:
        updated === rows.length
          ? `${updates(updated)} installed`
          : updated === 0
            ? `${updates(rows.length)} failed`
            : `${updated} of ${updates(rows.length)} installed`,
    };
  }
  const providerName = PROVIDER_DISPLAY_NAMES[drivers[0]!] ?? drivers[0]!;
  const machines = (count: number) => (count === 1 ? "1 machine" : `${count} machines`);
  return {
    type,
    title:
      updated === rows.length
        ? `${providerName} updated on ${machines(updated)}`
        : updated === 0
          ? `${providerName} update failed on ${machines(rows.length)}`
          : `${providerName} updated on ${updated} of ${machines(rows.length)}`,
  };
}
