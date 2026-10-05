import { useNavigate } from "@tanstack/react-router";
import { InboxIcon } from "lucide-react";

import { useOpenDecisions } from "~/state/decisions";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Sidebar entry to the Decisions tab, with the open count. */
export function SidebarDecisionsItem() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const count = useOpenDecisions().entries.length;
  const label = count > 0 ? `Decisions (${count} open)` : "Decisions";
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              size="icon"
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigate({ to: "/decisions" });
              }}
            >
              <span className="relative">
                <InboxIcon />
                {count > 0 ? (
                  <span className="absolute -top-1.5 -right-2 min-w-3.5 rounded-full bg-primary px-1 text-center text-3xs leading-3.5 font-medium text-primary-foreground">
                    {count}
                  </span>
                ) : null}
              </span>
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
