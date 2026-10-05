import {
  type DecisionAnswer,
  type DecisionItem,
  type Project,
  ProjectId,
  ProviderInstanceId,
  type ServerProvider,
} from "@cz/contracts";
import { assert, describe, it } from "@effect/vitest";

import { findProject, followUpFor, pickModel } from "./DecisionFollowUps.ts";

const item = (overrides: Partial<DecisionItem>): DecisionItem => ({
  id: "d1",
  project: "hll",
  kind: "listen",
  title: "Footsteps",
  question: "Which footsteps?",
  body_md: "",
  media: [],
  options: [
    { id: "a", label: "Gravel", media_idx: null },
    { id: "b", label: "Wood", media_idx: null },
  ],
  max_choices: 1,
  steps: [],
  context_media_idx: null,
  priority: 0,
  created_by: "agent",
  thread: "thread-1",
  blocking: false,
  default: null,
  expires_at: null,
  cost_note: null,
  resume: { project: "hll", prompt: "Wire the kept footsteps into the player." },
  status: "answered",
  created_at: 0,
  updated_at: 0,
  answered_at: 0,
  ...overrides,
});

const answer = (overrides: Partial<DecisionAnswer> = {}): DecisionAnswer => ({
  item_id: "d1",
  choice: null,
  option_ids: ["b"],
  rank: null,
  comment: "softer",
  voice_key: null,
  decided_by: "owner",
  decided_at: 0,
  ...overrides,
});

describe("followUpFor", () => {
  it("resumes a non-blocking item with the answer in the prompt, starting when quota allows", () => {
    const plan = followUpFor(item({}), answer());
    assert.equal(plan?.source, "resume");
    assert.equal(plan?.start, "when-available");
    assert.include(plan?.prompt ?? "", "Wire the kept footsteps");
    assert.include(plan?.prompt ?? "", "Wood; comment: softer");
    assert.equal(plan?.threadId, "thread-1");
  });

  it("leaves blocking items to the waiting agent, and items without a plan alone", () => {
    assert.isNull(followUpFor(item({ blocking: true }), answer()));
    assert.isNull(followUpFor(item({ resume: null }), answer()));
  });

  it("queues an approved pitch for the reset, and nothing for later or never", () => {
    const pitch = item({ kind: "pitch", resume: null, title: "Night market level" });
    const yes = followUpFor(pitch, answer({ choice: "yes", option_ids: null }));
    assert.equal(yes?.source, "pitch");
    assert.equal(yes?.start, "reset");
    assert.equal(yes?.project, "hll");
    assert.include(yes?.prompt ?? "", "Night market level");
    assert.isNull(followUpFor(pitch, answer({ choice: "later", option_ids: null })));
  });
});

const project = (id: string, title: string, workspaceRoot: string): Project => ({
  id: ProjectId.make(id),
  title,
  workspaceRoot,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  deletedAt: null,
});

describe("findProject", () => {
  const projects = [
    project("p1", "Hollow Light", "/Users/c/Games/hll"),
    project("p2", "czcode", "/Users/c/SWE/czcode"),
  ];
  it("matches by id, path, title, or folder name", () => {
    assert.equal(findProject(projects, "p2")?.id, "p2");
    assert.equal(findProject(projects, "/Users/c/SWE/czcode")?.id, "p2");
    assert.equal(findProject(projects, "hollow light")?.id, "p1");
    assert.equal(findProject(projects, "hll")?.id, "p1");
    assert.isNull(findProject(projects, "nope"));
  });
});

describe("pickModel", () => {
  const claude = ProviderInstanceId.make("claude");
  const codex = ProviderInstanceId.make("codex");
  const providers = [
    {
      instanceId: codex,
      models: [
        { slug: "gpt-a", name: "A", isCustom: false },
        { slug: "gpt-b", name: "B", isCustom: false, isDefault: true },
      ],
    },
  ] as unknown as ReadonlyArray<ServerProvider>;

  it("prefers the first candidate on the named provider", () => {
    assert.deepEqual(
      pickModel({
        provider: "codex",
        candidates: [
          { instanceId: claude, model: "opus" },
          { instanceId: codex, model: "gpt-a" },
        ],
        providers,
      }),
      { instanceId: codex, model: "gpt-a" },
    );
  });

  it("falls back to the provider's default model", () => {
    assert.deepEqual(pickModel({ provider: "codex", candidates: [null], providers }), {
      instanceId: codex,
      model: "gpt-b",
    });
    assert.isNull(pickModel({ provider: "grok", candidates: [], providers }));
  });
});
