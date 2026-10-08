import { DIFFERS_BY_MACHINE } from "./scopedSettings";
import type { StorageCleanupSettings, WorktreeCleanupRules } from "@cz/contracts";
import { resolveWorktreeCleanup } from "@cz/shared/projectSettings";
import { useRef, useState } from "react";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { describeMachineDifferences, type ScopedSettingsTarget } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useClearScopedSettings,
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function WorktreesDirectoryRow() {
  const { connectedEnvironments, targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["worktreesDirectory"]);
  const edited = useRef(false);
  if (
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.worktreesDirectory !== true,
    )
  )
    return null;
  const scopeKey = targets.map((target) => target.environmentId).join(",");

  return (
    <SettingsRow
      {...searchableSetting("storage-worktrees-location")}
      description={
        "Folder where new worktrees are created, on any drive, such as D:\\worktrees or ~/worktrees. Existing worktrees stay where they are. Leave empty to use the cz home folder."
      }
      serverScoped
      settingKeys={["worktreesDirectory"]}
      resetAction={
        mixed || settings.worktreesDirectory !== "" ? (
          <SettingResetButton
            label="worktree location"
            onClick={() => updateSettings({ worktreesDirectory: "" })}
          />
        ) : null
      }
      control={
        <Input
          key={`${scopeKey}:${mixed}:${settings.worktreesDirectory}`}
          aria-label="Worktree location"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={mixed ? DIFFERS_BY_MACHINE : "Default"}
          defaultValue={mixed ? "" : settings.worktreesDirectory}
          onChange={() => {
            edited.current = true;
          }}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.worktreesDirectory))
              updateSettings({ worktreesDirectory: value });
            edited.current = false;
          }}
        />
      }
    />
  );
}

function RetentionControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-3">
      {value !== null ? (
        <NumberField
          value={draft}
          min={1}
          max={3650}
          step={1}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            if (next === null) setDraft(value);
            else {
              const days = Math.min(3650, Math.max(1, Math.round(next)));
              setDraft(days);
              onChange(days);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={`Decrease ${label}`} />
            <NumberFieldInput
              aria-label={`${label} in days`}
              size={new Intl.NumberFormat().format(draft ?? value).length}
              className="field-sizing-content w-auto min-w-[1ch] grow-0 text-right"
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              days
            </span>
            <NumberFieldIncrement aria-label={`Increase ${label}`} />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">Off</span>
      )}
      <Switch
        aria-label={label}
        checked={value !== null}
        onCheckedChange={(enabled) => onChange(enabled ? 14 : null)}
      />
    </div>
  );
}

/** Machines' retention values differ: name who has what, like other settings rows. */
function formatRuleValue(key: keyof StorageCleanupSettings, value: number | boolean | null) {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === null) return "Off";
  return key.endsWith("AfterDays") ? `${value} ${value === 1 ? "day" : "days"}` : String(value);
}

function useStorageCleanup() {
  const { scope, connectedEnvironments, targets, target } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = {
    ...scopedSettings.storageCleanup,
    ...resolveWorktreeCleanup(scopedSettings, null),
  };
  const updateSettings = useUpdateScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) => {
    const valueOf = (entry: ScopedSettingsTarget) =>
      ({ ...entry.settings.storageCleanup, ...resolveWorktreeCleanup(entry.settings, null) })[key];
    return targets.some((entry) => valueOf(entry) !== settings[key]) ? (
      <>
        <span className="text-warning">{DIFFERS_BY_MACHINE}:</span>{" "}
        {describeMachineDifferences(targets, (entry) => formatRuleValue(key, valueOf(entry)))}
      </>
    ) : undefined;
  };
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const supported = connectedEnvironments.every(
    (environment) => environment.serverConfig?.environment.capabilities.storageCleanup === true,
  );
  return {
    isProjectScope,
    connectedEnvironments,
    targets,
    target,
    settings,
    ruleStatus,
    update,
    updateSettings,
    supported,
  };
}

/** Where worktrees go and when they are cleaned up. Lives on the Source Control page. */
export function WorktreeStorageSettingsSection() {
  const {
    isProjectScope,
    connectedEnvironments,
    targets,
    target,
    settings,
    ruleStatus,
    update,
    updateSettings,
    supported,
  } = useStorageCleanup();
  const clearSettings = useClearScopedSettings();
  const projectMode = (entry: ScopedSettingsTarget | null) =>
    entry?.sources.worktreeCleanup === "project"
      ? (entry.settings.worktreeCleanup?.mode ?? "inherit")
      : "inherit";
  const mode = projectMode(target);
  const mixedModes = targets.some((entry) => projectMode(entry) !== mode);
  const updateWorktree = (patch: Partial<WorktreeCleanupRules>) =>
    isProjectScope
      ? updateSettings({ worktreeCleanup: { mode: "custom", rules: patch } })
      : update(patch);
  const projectCleanupSupported = connectedEnvironments.every(
    (environment) =>
      environment.serverConfig?.environment.capabilities.projectWorktreeCleanup === true,
  );

  if (!supported || (isProjectScope && !projectCleanupSupported)) {
    return (
      <SettingsSection id="storage-worktrees" title="Worktrees">
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Update the selected machines to change worktree cleanup.
        </p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection id="storage-worktrees" title="Worktrees">
      {!isProjectScope && <WorktreesDirectoryRow />}
      {isProjectScope && (
        <SettingsRow
          title="Automatic worktree cleanup"
          description={
            mode === "off"
              ? "Keep this project's worktrees until you delete them manually."
              : mode === "custom"
                ? "Use these rules for this project."
                : "Use each machine's worktree cleanup settings."
          }
          serverScoped
          settingKeys={["worktreeCleanup"]}
          mixed={mixedModes}
          control={
            <Select
              value={mixedModes ? null : mode}
              onValueChange={(next) => {
                if (next === "inherit") clearSettings(["worktreeCleanup"]);
                else if (next === "off") updateSettings({ worktreeCleanup: { mode: "off" } });
                else if (next === "custom")
                  updateSettings({ worktreeCleanup: { mode: "custom", rules: {} } });
              }}
            >
              <SelectTrigger size="sm" aria-label="Automatic worktree cleanup">
                <SelectValue>
                  {mixedModes
                    ? DIFFERS_BY_MACHINE
                    : mode === "inherit"
                      ? "Inherit"
                      : mode === "off"
                        ? "Off"
                        : "Custom"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="inherit">Inherit</SelectItem>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      )}
      {(!isProjectScope || (!mixedModes && mode === "custom")) && (
        <>
          <SettingsRow
            title="Delete worktrees with deleted threads"
            status={ruleStatus("worktreeOnDelete")}
            description="Remove unused worktrees when active or archived threads are deleted. Worktrees with local changes are kept."
            serverScoped={!isProjectScope}
            control={
              <Switch
                aria-label="Delete worktrees with deleted threads"
                checked={settings.worktreeOnDelete}
                onCheckedChange={(worktreeOnDelete) => updateWorktree({ worktreeOnDelete })}
              />
            }
          />
          <SettingsRow
            title="Delete inactive worktrees"
            status={ruleStatus("worktreeAfterDays")}
            description="Remove worktrees after their threads have been inactive for this many days. Worktrees with local changes, branches and thread history are kept."
            serverScoped={!isProjectScope}
            control={
              <RetentionControl
                label="Delete inactive worktrees"
                value={settings.worktreeAfterDays}
                onChange={(worktreeAfterDays) => updateWorktree({ worktreeAfterDays })}
              />
            }
          />
          <SettingsRow
            title="Delete merged worktrees"
            status={ruleStatus("worktreeOnMerge")}
            description="Remove worktrees whose pull request is merged and whose commits are included in the default branch."
            serverScoped={!isProjectScope}
            control={
              <Switch
                aria-label="Delete merged worktrees"
                checked={settings.worktreeOnMerge}
                onCheckedChange={(worktreeOnMerge) => updateWorktree({ worktreeOnMerge })}
              />
            }
          />
          <SettingsRow
            title="Delete unchanged worktrees"
            status={ruleStatus("worktreeUnchanged")}
            description="Remove worktrees with no commits beyond the default branch."
            serverScoped={!isProjectScope}
            control={
              <Switch
                aria-label="Delete unchanged worktrees"
                checked={settings.worktreeUnchanged}
                onCheckedChange={(worktreeUnchanged) => updateWorktree({ worktreeUnchanged })}
              />
            }
          />
        </>
      )}
    </SettingsSection>
  );
}

/** Browser capture and log retention. Lives on the General page. */
export function ArtifactStorageSettingsSection() {
  const { isProjectScope, settings, ruleStatus, update, supported } = useStorageCleanup();
  if (isProjectScope || !supported) return null;
  return (
    <SettingsSection id="storage-artifacts" title="Artifacts and logs">
      <SettingsRow
        title="Delete old browser artifacts"
        status={ruleStatus("browserArtifactsAfterDays")}
        description="Delete saved browser captures after this many days. Older capture links will no longer open."
        serverScoped
        control={
          <RetentionControl
            label="Delete old browser artifacts"
            value={settings.browserArtifactsAfterDays}
            onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
          />
        }
      />
      <SettingsRow
        title="Delete old rotated logs"
        status={ruleStatus("logsAfterDays")}
        description="Delete inactive rotated log files after this many days. Current logs are kept."
        serverScoped
        control={
          <RetentionControl
            label="Delete old rotated logs"
            value={settings.logsAfterDays}
            onChange={(logsAfterDays) => update({ logsAfterDays })}
          />
        }
      />
    </SettingsSection>
  );
}
