import { assert, describe, it } from "@effect/vitest";

import {
  CZ_ORCHESTRATION_INSTRUCTIONS,
  czAcpPromptWithInstructions,
  czOrchestrationPromptForFirstRun,
  czOrchestrationSystemPrompt,
} from "./CzOrchestrationInstructions.ts";

describe("cz orchestration provider instructions", () => {
  it("distinguishes delegated subagents from ordinary top-level threads", () => {
    assert.include(CZ_ORCHESTRATION_INSTRUCTIONS, "Use `delegate_task`");
    assert.include(CZ_ORCHESTRATION_INSTRUCTIONS, "ordinary top-level cz conversations");
    assert.include(CZ_ORCHESTRATION_INSTRUCTIONS, "Never use them merely");
    assert.include(CZ_ORCHESTRATION_INSTRUCTIONS, "cross-provider");
    assert.include(CZ_ORCHESTRATION_INSTRUCTIONS, "call `delegate_task` again");
    assert.include(CZ_ORCHESTRATION_INSTRUCTIONS, "Do not use `cz_thread_send` on `childThreadId`");
  });

  it("documents structured schedules instead of JSON strings", () => {
    assert.include(CZ_ORCHESTRATION_INSTRUCTIONS, "structured object, never as JSON text");
    assert.include(CZ_ORCHESTRATION_INSTRUCTIONS, '"everyMs":3600000');
    assert.include(CZ_ORCHESTRATION_INSTRUCTIONS, "bindToCurrentThread=false");
  });

  it("injects prompt fallback only for an MCP-enabled first run", () => {
    const prompt = "Inspect the repository.";
    const injected = czOrchestrationPromptForFirstRun({
      prompt,
      runOrdinal: 1,
      hasCzMcp: true,
    });

    assert.include(injected, "<czcode_orchestration_instructions>");
    assert.include(injected, `<user_request>\n${prompt}\n</user_request>`);
    assert.equal(
      czOrchestrationPromptForFirstRun({ prompt, runOrdinal: 2, hasCzMcp: true }),
      prompt,
    );
    assert.equal(
      czOrchestrationPromptForFirstRun({ prompt, runOrdinal: 1, hasCzMcp: false }),
      prompt,
    );
  });

  it("only exposes the system prompt when the cz MCP server is attached", () => {
    assert.equal(czOrchestrationSystemPrompt(false), undefined);
    assert.equal(czOrchestrationSystemPrompt(true), CZ_ORCHESTRATION_INSTRUCTIONS);
  });

  it("gives ACP sessions provider-neutral mode, browser, and orchestration guidance", () => {
    const injected = czAcpPromptWithInstructions({
      prompt: "Inspect the repository.",
      state: { interactionMode: "default", hasCzMcp: true },
    });

    assert.include(injected, "czcode interaction mode: Default");
    assert.include(injected, "czcode collaborative browser");
    assert.include(injected, "czcode orchestration");
    assert.include(injected, "<user_request>\nInspect the repository.\n</user_request>");
  });

  it("reinjects ACP guidance only when mode or tool availability changes", () => {
    const prompt = "Continue.";
    const defaultState = { interactionMode: "default", hasCzMcp: true } as const;

    assert.equal(
      czAcpPromptWithInstructions({ prompt, state: defaultState, previousState: defaultState }),
      prompt,
    );
    assert.include(
      czAcpPromptWithInstructions({
        prompt,
        state: { ...defaultState, interactionMode: "plan" },
        previousState: defaultState,
      }),
      "czcode interaction mode: Plan",
    );
    const withoutMcp = czAcpPromptWithInstructions({
      prompt,
      state: { interactionMode: "default", hasCzMcp: false },
    });
    assert.include(withoutMcp, "czcode interaction mode: Default");
    assert.notInclude(withoutMcp, "czcode collaborative browser");
    assert.notInclude(withoutMcp, "czcode orchestration");
  });
});
