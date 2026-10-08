import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, ProviderInstanceId } from "@cz/contracts";

import { ProviderMachineMatrix } from "../components/settings/ProviderMachineMatrix";
import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { useSettingsSearchTargetId } from "../components/settings/settingsLayout";

/**
 * Providers are machine state. With every machine selected the page shows a
 * provider-by-machine overview; picking a machine (or a cell) edits that
 * machine's providers. A project crumb narrows candidates to where that
 * project is registered.
 */
function SettingsProvidersRoute() {
  const target = Route.useSearch();
  const { environment, scope, search } = useSettingsScope();
  // A search jump to a per-machine row (health checks, usage providers) needs
  // the machine page, which carries that row; the overview does not.
  const searchTargetId = useSettingsSearchTargetId();
  const overview =
    search.machine === undefined &&
    scope.kind !== "checkout" &&
    !target.environmentId &&
    (searchTargetId === null || searchTargetId === "providers");
  if (overview) {
    return <ProviderMachineMatrix />;
  }
  if (!environment) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        {scope.kind === "environment"
          ? `Reconnect ${scope.label} to set up its providers.`
          : "Connect an environment to set up its providers."}
      </p>
    );
  }
  return (
    <ProviderSettingsPanel
      environmentId={target.environmentId ?? environment.environmentId}
      {...(target.instanceId ? { instanceId: target.instanceId } : {})}
      scoped
    />
  );
}

export const Route = createFileRoute("/settings/providers")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.instanceId === "string" && raw.instanceId.trim()
      ? { instanceId: ProviderInstanceId.make(raw.instanceId) }
      : {}),
  }),
  component: SettingsProvidersRoute,
});
