import { describe, expect, it } from "vite-plus/test";

import { hostServiceCgroupProblem } from "./hostService.ts";

describe("hostServiceCgroupProblem", () => {
  it("is the service itself, never a server an agent or terminal started", () => {
    const app = "/user.slice/user-1000.slice/user@1000.service/app.slice";
    expect(hostServiceCgroupProblem(`${app}/cz-host.service`)).toBe(null);
    // A dev server, test, or `cz serve` launched by an agent on the host.
    expect(hostServiceCgroupProblem(`${app}/cz-agent-4242-claude.scope`)).toContain(
      "cz-agent-4242-claude.scope",
    );
    // A terminal session.
    expect(hostServiceCgroupProblem(`${app}/app-ghostty-1234.scope`)).not.toBe(null);
    expect(hostServiceCgroupProblem("/system.slice/ssh.service")).not.toBe(null);
    expect(hostServiceCgroupProblem(undefined)).not.toBe(null);
  });
});
