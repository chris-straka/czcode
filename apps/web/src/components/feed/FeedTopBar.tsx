import { shortMachineLabel } from "@cz/client-runtime/decisions/oneFeed";
import type { EnvironmentId } from "@cz/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChartNoAxesColumnIcon,
  ChevronDownIcon,
  ClockIcon,
  FolderPlusIcon,
  InboxIcon,
  MonitorIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { type ReactNode, useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { resolveMachineFilter, useFeedFilterStore } from "~/feedFilterStore";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  usePullRequestsSupported,
} from "~/state/environments";
import { fleetAtom, MachineLoadMeter, useLiveHostResources } from "../fleet/MachineLoad";
import { SchedulesFailureDot } from "../schedules/SchedulesPage";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { SidebarUpdatePill } from "../sidebar/SidebarUpdatePill";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarMenu } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

function TopBarButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button size="icon-sm" variant="ghost" aria-label={label} onClick={onClick} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

/** How often the machine filter's load meters refresh: open menu, and the shown machine. */
const LOAD_REFRESH_OPEN_MS = 3_000;
const LOAD_REFRESH_CLOSED_MS = 30_000;

/**
 * Which machines the feed shows: this one (the default), another, or all.
 * Each machine carries a small load meter (CPU, RAM, swap, disk, agents),
 * live while the menu is open; Machines opens the full Fleet view.
 */
function MachineFilterMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const machines = useAtomValue(fleetAtom);
  const machine = useFeedFilterStore((state) => state.machine);
  const setMachine = useFeedFilterStore((state) => state.setMachine);
  const showPhoneItems = useFeedFilterStore((state) => state.showPhoneItems);
  const setShowPhoneItems = useFeedFilterStore((state) => state.setShowPhoneItems);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const resolved = resolveMachineFilter(machine, primaryEnvironmentId);
  const label = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ?? "";
  const value = resolved.type === "all" ? "all" : resolved.environmentId;
  const machineOf = (environmentId: EnvironmentId) =>
    machines.find((machine) => machine.environmentId === environmentId);
  const shownMachine = resolved.type === "one" ? machineOf(resolved.environmentId) : undefined;
  const awakeIds = machines
    .filter((machine) => machine.state === "awake")
    .map((machine) => machine.environmentId);
  useLiveHostResources(awakeIds, LOAD_REFRESH_OPEN_MS, open);
  useLiveHostResources(
    shownMachine?.state === "awake" ? [shownMachine.environmentId] : [],
    LOAD_REFRESH_CLOSED_MS,
    !open,
  );
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={<Button size="sm" variant="outline" aria-label="Machines shown in the feed" />}
      >
        <MonitorIcon />
        <span className="max-w-32 truncate">
          {resolved.type === "all"
            ? "All machines"
            : shortMachineLabel(label(resolved.environmentId))}
        </span>
        {shownMachine ? (
          <span className="max-sm:hidden">
            <MachineLoadMeter machine={shownMachine} />
          </span>
        ) : null}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={value}
          onValueChange={(next) =>
            setMachine(
              next === "all"
                ? { type: "all" }
                : next === primaryEnvironmentId
                  ? null
                  : { type: "one", environmentId: next as EnvironmentId },
            )
          }
        >
          {environments.map((environment) => (
            <MenuRadioItem key={environment.environmentId} value={environment.environmentId}>
              <span className="flex items-center gap-4">
                <span className="min-w-0 flex-1 truncate">
                  {environment.label}
                  {environment.environmentId === primaryEnvironmentId ? " (this machine)" : ""}
                </span>
                {machineOf(environment.environmentId) ? (
                  <MachineLoadMeter machine={machineOf(environment.environmentId)!} />
                ) : null}
              </span>
            </MenuRadioItem>
          ))}
          <MenuSeparator />
          <MenuRadioItem value="all">All machines</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuCheckboxItem checked={showPhoneItems} onCheckedChange={setShowPhoneItems}>
          Show phone items
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuItem onClick={() => void navigate({ to: "/fleet" })}>
          <MonitorIcon />
          Machines
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** Opens Schedules; a red dot when a job failed on a machine the feed shows. */
function SchedulesButton() {
  const navigate = useNavigate();
  const machine = useFeedFilterStore((state) => state.machine);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const resolved = resolveMachineFilter(machine, primaryEnvironmentId);
  const shown =
    resolved.type === "all"
      ? environments.map((environment) => environment.environmentId)
      : [resolved.environmentId];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Schedules"
            onClick={() => void navigate({ to: "/schedules" })}
            className="relative"
          />
        }
      >
        <ClockIcon />
        {shown.map((environmentId) => (
          <SchedulesFailureDot key={environmentId} environmentId={environmentId} />
        ))}
      </TooltipTrigger>
      <TooltipPopup side="bottom">Schedules</TooltipPopup>
    </Tooltip>
  );
}

/** The feed's one slim bar: the machine filter, search, and every app-wide button. */
export function FeedTopBar({
  badge,
  reviewing,
  onReviewAll,
  filters,
}: {
  readonly badge: number;
  readonly reviewing: boolean;
  readonly onReviewAll: () => void;
  /** Games/software and project filters, beside the search bar. */
  readonly filters?: ReactNode;
}) {
  const navigate = useNavigate();
  const pullRequestsSupported = usePullRequestsSupported();
  return (
    <WorkspacePageHeader electron={isElectron} className="gap-1.5 border-b border-border">
      <MachineFilterMenu />
      <Button
        size="sm"
        variant="outline"
        className="min-w-0 flex-1 justify-start sm:max-w-80"
        onClick={() => openCommandPalette()}
      >
        <SearchIcon />
        <span className="truncate">Search</span>
      </Button>
      {filters ? <div className="flex items-center gap-1.5 max-md:hidden">{filters}</div> : null}
      <span className="flex-1 max-sm:hidden" />
      <TopBarButton
        label="New thread"
        onClick={() => openCommandPalette({ open: "new-thread-in" })}
      >
        <SquarePenIcon />
      </TopBarButton>
      <span className="max-sm:hidden">
        <TopBarButton
          label="Add project"
          onClick={() => openCommandPalette({ open: "add-project" })}
        >
          <FolderPlusIcon />
        </TopBarButton>
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={badge > 0 ? `Review ${badge} decisions` : "Decisions"}
              disabled={!reviewing}
              onClick={onReviewAll}
              className="relative"
            />
          }
        >
          <InboxIcon />
          {badge > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-primary px-1 text-center text-3xs leading-3.5 font-medium text-primary-foreground">
              {badge}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom">Review all decisions</TooltipPopup>
      </Tooltip>
      {pullRequestsSupported ? (
        <span className="max-sm:hidden">
          <TopBarButton
            label="Pull requests"
            onClick={() =>
              void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() })
            }
          >
            <PullRequestGlyph.pullRequest />
          </TopBarButton>
        </span>
      ) : null}
      <SchedulesButton />
      <span className="max-sm:hidden">
        <TopBarButton label="Usage" onClick={() => void navigate({ to: "/usage" })}>
          <ChartNoAxesColumnIcon />
        </TopBarButton>
      </span>
      <TopBarButton label="Settings" onClick={() => void navigate({ to: "/settings" })}>
        <SettingsIcon />
      </TopBarButton>
      {isElectron ? (
        <SidebarMenu className="w-auto flex-none">
          <SidebarUpdatePill />
        </SidebarMenu>
      ) : null}
    </WorkspacePageHeader>
  );
}
