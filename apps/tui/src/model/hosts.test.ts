import { describe, expect, it } from "vite-plus/test";
import type { ModelSelection, ProviderInstanceId, ServerConfig } from "@cz/contracts";

import { cycleEffort, modelLabel } from "./hosts.ts";

const config = {
  providers: [
    {
      instanceId: "claude" as ProviderInstanceId,
      models: [
        {
          slug: "opus",
          name: "Claude Opus",
          shortName: "Opus",
          capabilities: {
            optionDescriptors: [
              { id: "fastMode", label: "Fast", type: "boolean" },
              {
                id: "effort",
                label: "Effort",
                type: "select",
                options: [
                  { id: "low", label: "Low" },
                  { id: "high", label: "High", isDefault: true },
                  { id: "max", label: "Max" },
                ],
              },
            ],
          },
        },
        { slug: "haiku", name: "Haiku", capabilities: null },
      ],
    },
  ],
} as unknown as Pick<ServerConfig, "providers">;

const opus = { instanceId: "claude", model: "opus" } as ModelSelection;

describe("modelLabel", () => {
  it("names the model and its effort, defaulting to the model's default", () => {
    expect(modelLabel(opus, config)).toBe("Opus · High");
    expect(modelLabel({ ...opus, options: [{ id: "effort", value: "max" }] }, config)).toBe(
      "Opus · Max",
    );
  });

  it("falls back to the slug for a model the host doesn't list", () => {
    expect(modelLabel({ instanceId: "claude", model: "gone" } as ModelSelection, config)).toBe(
      "gone",
    );
  });
});

describe("cycleEffort", () => {
  it("steps through the effort choices and wraps", () => {
    const max = cycleEffort(opus, config);
    expect(max?.options).toEqual([{ id: "effort", value: "max" }]);
    expect(cycleEffort(max!, config)?.options).toEqual([{ id: "effort", value: "low" }]);
  });

  it("keeps other options the user set", () => {
    const fast = { ...opus, options: [{ id: "fastMode", value: true }] } as ModelSelection;
    expect(cycleEffort(fast, config)?.options).toEqual([
      { id: "fastMode", value: true },
      { id: "effort", value: "max" },
    ]);
  });

  it("has nothing to cycle on a model without choices", () => {
    expect(cycleEffort({ instanceId: "claude", model: "haiku" } as ModelSelection, config)).toBe(
      null,
    );
  });
});
