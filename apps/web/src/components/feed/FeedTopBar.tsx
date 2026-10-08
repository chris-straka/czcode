import { shortMachineLabel } from "@cz/client-runtime/decisions/oneFeed";
import type { EnvironmentId } from "@cz/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChartNoAxesColumnIcon,
  ChevronDownIcon,
  FolderPlusIcon,
  InboxIcon,
  MonitorIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { resolveMachineFilter, useFeedFilterStore } from "~/feedFilterStore";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  usePullRequestsSupported,
} from "~/state/environments";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { SidebarUpdatePill } from "../sidebar/SidebarUpdatePill";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
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

/** Which machines the feed shows: this one (the default), another, or all. */
function MachineFilterMenu() {
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
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="sm" variant="outline" aria-label="Machines shown in the feed" />}
      >
        <MonitorIcon />
        <span className="max-w-32 truncate">
          {resolved.type === "all"
            ? "All machines"
            : shortMachineLabel(label(resolved.environmentId))}
        </span>
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
              {environment.label}
              {environment.environmentId === primaryEnvironmentId ? " (this machine)" : ""}
            </MenuRadioItem>
          ))}
          <MenuSeparator />
          <MenuRadioItem value="all">All machines</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuCheckboxItem checked={showPhoneItems} onCheckedChange={setShowPhoneItems}>
          Show phone items
        </MenuCheckboxItem>
      </MenuPopup>
    </Menu>
  );
}

/** The feed's one slim bar: the machine filter, search, and every app-wide button. */
export function FeedTopBar({
  badge,
  reviewing,
  onReviewAll,
}: {
  readonly badge: number;
  readonly reviewing: boolean;
  readonly onReviewAll: () => void;
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
