import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";

import { isElectron } from "../env";
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { resolveThreadRouteRef } from "../threadRoutes";
import { isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import { useThreadVisitedMigration } from "../hooks/useThreadVisitedMigration";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { MainAppLocationTracker } from "./sidebar/mainAppLocation";
import { useProjects } from "../state/entities";
import { SidebarProvider } from "./ui/sidebar";
import { useNavigateBack } from "../hooks/useNavigateBack";
import { FeedModal } from "./feed/FeedModal";
import { FeedPage } from "./feed/FeedPage";

// Ends just past the third traffic light (see the desktop preload).
const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "var(--desktop-window-controls-inset, 78px)";

// Moves through the app's route history like a browser's back/forward buttons.
function NavigationHistoryShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeThreadRef
            ? selectThreadTerminalUiState(
                useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
                routeThreadRef,
              ).terminalOpen
            : false,
          previewFocus: isPreviewFocused(),
          previewOpen: routeThreadRef
            ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, routeThreadRef) ===
              "preview"
            : false,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "navigation.back" && command !== "navigation.forward") return;

      event.preventDefault();
      event.stopPropagation();
      if (command === "navigation.back") window.history.back();
      else window.history.forward();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, routeThreadRef]);

  return null;
}

// Keep the lightweight project projection subscribed so returning to a draft
// never renders the zero-project state while the environment snapshot
// reconnects.
function ProjectProjectionRetention() {
  useProjects();
  return null;
}

/** Routes the feed itself answers; everything else opens over it as its own view. */
function isFeedRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/threads" || pathname === "/decisions";
}

/**
 * The one feed stays mounted under every route, keeping its scroll and state;
 * any other page (a thread, a draft, settings, usage, pull requests) opens as
 * a full view over it, and Back returns to where the owner came from.
 */
function OneFeedShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const navigateBack = useNavigateBack();
  if (pathname === "/welcome") return children;
  const isSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  return (
    <>
      <FeedPage />
      {isFeedRoute(pathname) ? (
        children
      ) : (
        <FeedModal label={isSettings ? "Settings" : "Thread"} onClose={navigateBack}>
          {isSettings ? (
            <div className="flex min-h-0 flex-1">
              <nav
                aria-label="Settings"
                className="w-56 shrink-0 overflow-y-auto border-e border-border max-md:hidden"
              >
                <SettingsSidebarNav pathname={pathname} />
              </nav>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
            </div>
          ) : (
            children
          )}
        </FeedModal>
      )}
    </>
  );
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  // Settings routes show the settings nav in place of whichever thread
  // sidebar is active.
  // Seeds server-side visited tracking from this browser's localStorage the
  useThreadVisitedMigration();
  const pathname = useLocation({ select: (location) => location.pathname });
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  const sidebarProviderStyle = {
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
    // No sidebar toggle sits in the title bar any more, so headers start
    // right at the window controls instead of leaving room for one.
    "--workspace-titlebar-content-left": "var(--workspace-controls-left)",
    ...(isMacosDesktop && !isWindowFullscreen
      ? { "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET }
      : {}),
  } as CSSProperties;

  useEffect(() => {
    if (!isMacosDesktop) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const { getWindowFullscreenState, onWindowFullscreenStateChange } = bridge;
    if (
      typeof getWindowFullscreenState !== "function" ||
      typeof onWindowFullscreenStateChange !== "function"
    ) {
      return;
    }

    const unsubscribe = onWindowFullscreenStateChange(setIsWindowFullscreen);
    setIsWindowFullscreen(getWindowFullscreenState());
    return unsubscribe;
  }, [isMacosDesktop]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  return (
    <PanelAnimationSuppressionProvider value={panelAnimationsSuppressed}>
      {/* No sidebar: the provider stays collapsed so every header keeps its
          title-bar inset, and components that read sidebar state keep working. */}
      <SidebarProvider
        className="h-dvh! min-h-0!"
        data-panel-animations={routePanelAnimationsActive ? "true" : "false"}
        open={false}
        onOpenChange={() => {}}
        style={sidebarProviderStyle}
      >
        <ProjectProjectionRetention />
        <OneFeedShell pathname={pathname}>{children}</OneFeedShell>
        <NavigationHistoryShortcuts />
        <MainAppLocationTracker />
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
