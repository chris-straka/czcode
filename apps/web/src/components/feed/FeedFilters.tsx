import type { FeedProjectGroup } from "@cz/client-runtime/decisions/oneFeed";
import { ChevronDownIcon, FolderIcon } from "lucide-react";

import { useFeedFilterStore } from "~/feedFilterStore";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

export interface FeedProjectChoice {
  readonly name: string;
  readonly group: FeedProjectGroup;
  readonly description: string | null;
}

/** All, games only, or everything but games. Next to the search bar, for every machine choice. */
export function FeedGroupToggle() {
  const group = useFeedFilterStore((state) => state.group);
  const setGroup = useFeedFilterStore((state) => state.setGroup);
  return (
    <ToggleGroup
      aria-label="Games or software"
      variant="segmented"
      value={[group ?? "all"]}
      onValueChange={(value) => {
        const next = value[0];
        setGroup(next === "games" || next === "software" ? next : null);
      }}
    >
      <Toggle size="sm" value="all">
        All
      </Toggle>
      <Toggle size="sm" value="games">
        Games
      </Toggle>
      <Toggle size="sm" value="software">
        Software
      </Toggle>
    </ToggleGroup>
  );
}

/**
 * Pick projects to show, from every thread's and Decision's project on the
 * machines shown, in Games and Software sections; each says what it is.
 */
export function FeedProjectsMenu({
  projects,
}: {
  readonly projects: readonly FeedProjectChoice[];
}) {
  const selected = useFeedFilterStore((state) => state.projects);
  const setProjects = useFeedFilterStore((state) => state.setProjects);
  const group = useFeedFilterStore((state) => state.group);
  const shown = projects.filter((project) => group === null || project.group === group);
  const sections = (["games", "software"] as const)
    .map((section) => ({
      section,
      label: section === "games" ? "Games" : "Software",
      projects: shown.filter((project) => project.group === section),
    }))
    .filter((section) => section.projects.length > 0);
  const toggle = (name: string, on: boolean) =>
    setProjects(on ? [...selected, name] : selected.filter((value) => value !== name));
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={selected.length > 0 ? "secondary" : "outline"}
            aria-label="Projects shown"
          />
        }
      >
        <FolderIcon />
        <span className="max-w-32 truncate">
          {selected.length === 0
            ? "All projects"
            : selected.length === 1
              ? selected[0]
              : `${selected.length} projects`}
        </span>
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-[70vh] w-80 overflow-y-auto">
        {selected.length > 0 ? (
          <>
            <MenuItem onClick={() => setProjects([])}>Show all projects</MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        {sections.map(({ section, label, projects: list }) => (
          <MenuGroup key={section}>
            <MenuGroupLabel>{label}</MenuGroupLabel>
            {list.map((project) => (
              <MenuCheckboxItem
                key={project.name}
                checked={selected.includes(project.name)}
                onCheckedChange={(on) => toggle(project.name, on)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{project.name}</span>
                  {project.description ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {project.description}
                    </span>
                  ) : null}
                </span>
              </MenuCheckboxItem>
            ))}
          </MenuGroup>
        ))}
      </MenuPopup>
    </Menu>
  );
}
