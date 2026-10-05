import type { DecisionSubmitInput } from "@cz/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ForkDatabase from "../forkDatabase/ForkDatabase.ts";
import * as DecisionService from "./DecisionService.ts";

const TestLayer = DecisionService.layer.pipe(
  Layer.provideMerge(ForkDatabase.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "cz-decisions-" })),
  Layer.provideMerge(NodeServices.layer),
);

const pick = (overrides: Partial<DecisionSubmitInput> = {}): DecisionSubmitInput => ({
  project: "hll",
  kind: "pick",
  title: "Andras concepts",
  question: "Which Andras?",
  options: [
    { id: "a", label: "A", media_idx: null },
    { id: "b", label: "B", media_idx: null },
  ],
  ...overrides,
});

const failureTag = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error._tag),
  );

it.layer(TestLayer)("DecisionService", (it) => {
  describe("submit", () => {
    it.effect("rejects submissions that don't hold together", () =>
      Effect.gen(function* () {
        const decisions = yield* DecisionService.DecisionService;
        assert.equal(
          yield* failureTag(
            decisions.submit(pick({ options: [{ id: "a", label: "A", media_idx: null }] })),
          ),
          "DecisionInvalidError",
        );
        assert.equal(
          yield* failureTag(
            decisions.submit(
              pick({
                options: [
                  { id: "a", label: "A", media_idx: 0 },
                  { id: "b", label: "B", media_idx: null },
                ],
              }),
            ),
          ),
          "DecisionInvalidError",
        );
        assert.equal(
          yield* failureTag(
            decisions.submit(
              pick({
                media: [
                  {
                    type: "image",
                    key: "00000000-0000-4000-8000-000000000000.png",
                    name: "a.png",
                    mime: "image/png",
                    size: 1,
                  },
                ],
              }),
            ),
          ),
          "DecisionInvalidError",
        );
        assert.equal(
          yield* failureTag(decisions.submit(pick({ default: "z" }))),
          "DecisionInvalidError",
        );
      }),
    );

    it.effect("stores uploaded media with the item and lists open items newest first", () =>
      Effect.gen(function* () {
        const decisions = yield* DecisionService.DecisionService;
        const ref = yield* decisions.putMedia(
          { name: "Hero A.PNG", mime: "image/png", type: "image" },
          new Uint8Array([1, 2, 3]),
        );
        assert.match(ref.key, /^[0-9a-f-]{36}\.png$/);
        assert.isTrue(Option.isSome(yield* decisions.mediaPath(ref.key)));
        assert.isTrue(Option.isNone(yield* decisions.mediaPath("../../etc/passwd")));

        yield* TestClock.adjust(Duration.millis(1));
        const first = yield* decisions.submit(
          pick({
            project: "media",
            media: [ref],
            options: [
              { id: "a", label: "A", media_idx: 0 },
              { id: "b", label: "B", media_idx: null },
            ],
          }),
        );
        yield* TestClock.adjust(Duration.millis(1));
        const second = yield* decisions.submit(pick({ project: "media" }));
        const listed = yield* decisions.list({ project: "media" });
        assert.deepStrictEqual(
          listed.map(({ item }) => item.id),
          [second.id, first.id],
        );
        assert.deepStrictEqual(listed[1]?.item.media, [ref]);
      }),
    );
  });

  describe("answer", () => {
    it.effect("checks each kind's answer and closes the item once", () =>
      Effect.gen(function* () {
        const decisions = yield* DecisionService.DecisionService;
        const answer = (id: string, input: Partial<Parameters<typeof decisions.answer>[1]>) =>
          decisions.answer(id, {
            choice: null,
            option_ids: null,
            rank: null,
            comment: null,
            voice_key: null,
            ...input,
          });

        const picked = yield* decisions.submit(pick({ project: "answers" }));
        assert.equal(
          yield* failureTag(answer(picked.id, { option_ids: ["a", "b"] })),
          "DecisionInvalidError",
        );
        assert.equal(
          yield* failureTag(answer(picked.id, { option_ids: ["z"] })),
          "DecisionInvalidError",
        );
        const recorded = yield* answer(picked.id, { option_ids: ["b"], comment: "darker" });
        assert.equal(recorded.decided_by, "owner");
        assert.equal(
          yield* failureTag(answer(picked.id, { option_ids: ["a"] })),
          "DecisionClosedError",
        );
        const read = yield* decisions.get(picked.id);
        assert.equal(read.item.status, "answered");
        assert.deepStrictEqual(read.answer?.option_ids, ["b"]);

        const ranked = yield* decisions.submit(pick({ project: "answers", kind: "rank" }));
        assert.equal(yield* failureTag(answer(ranked.id, { rank: ["a"] })), "DecisionInvalidError");
        yield* answer(ranked.id, { rank: ["b", "a"] });

        const review = yield* decisions.submit(
          pick({ project: "answers", kind: "review", options: [] }),
        );
        assert.equal(
          yield* failureTag(answer(review.id, { choice: "maybe" })),
          "DecisionInvalidError",
        );
        yield* answer(review.id, {
          choice: "changes",
          redlines: [
            {
              media_idx: 0,
              points: [
                [0.1, 0.2],
                [0.3, 0.4],
              ],
              note: "too busy",
            },
          ],
        });

        const timeline = yield* decisions.submit(
          pick({
            project: "answers",
            kind: "timeline",
            options: [],
            steps: [
              { id: "concept", label: "Concept", media_idx: null, status: "done" },
              { id: "model", label: "Model", media_idx: null, status: "done" },
            ],
          }),
        );
        assert.equal(
          yield* failureTag(answer(timeline.id, { choice: "redo" })),
          "DecisionInvalidError",
        );
        yield* answer(timeline.id, { choice: "redo", redo_from: "model" });

        const listen = yield* decisions.submit(pick({ project: "answers", kind: "listen" }));
        assert.equal(yield* failureTag(answer(listen.id, {})), "DecisionInvalidError");
        yield* answer(listen.id, {
          reactions: [
            { option_id: "a", verdict: "keep" },
            { option_id: "b", verdict: "kill", note: "too retro" },
          ],
          more_like_these: true,
        });

        const request = yield* decisions.submit(
          pick({ project: "answers", kind: "request", options: [] }),
        );
        assert.equal(yield* failureTag(answer(request.id, {})), "DecisionInvalidError");
        yield* answer(request.id, { comment: "Zone brief: ruined chapel, dusk." });

        const retried = yield* decisions.submit(pick({ project: "answers" }));
        yield* TestClock.adjust(Duration.millis(5));
        yield* answer(retried.id, { retry: true, comment: "none of these, warmer palette" });

        const history = yield* decisions.history({ project: "answers" });
        assert.equal(history.length, 7);
        assert.equal(history[0]?.item.id, retried.id);
      }),
    );

    it.effect("withdraws an open item and refuses to withdraw it twice", () =>
      Effect.gen(function* () {
        const decisions = yield* DecisionService.DecisionService;
        const item = yield* decisions.submit(pick({ project: "withdraw" }));
        assert.equal((yield* decisions.withdraw(item.id)).status, "withdrawn");
        assert.equal(yield* failureTag(decisions.withdraw(item.id)), "DecisionClosedError");
        assert.equal(yield* failureTag(decisions.get("missing")), "DecisionNotFoundError");
      }),
    );
  });

  it.effect("wakes a waiting agent when the owner answers", () =>
    Effect.gen(function* () {
      const decisions = yield* DecisionService.DecisionService;
      const item = yield* decisions.submit(pick({ project: "wait", blocking: true }));
      const waiting = yield* Effect.forkChild(decisions.wait(item.id, Duration.minutes(5)));
      yield* Effect.yieldNow;
      yield* decisions.answer(item.id, {
        choice: null,
        option_ids: ["a"],
        rank: null,
        comment: null,
        voice_key: null,
      });
      const result = yield* Fiber.join(waiting);
      assert.equal(result.item.status, "answered");
      assert.deepStrictEqual(result.answer?.option_ids, ["a"]);

      const untouched = yield* decisions.submit(pick({ project: "wait" }));
      const timedOut = yield* Effect.forkChild(decisions.wait(untouched.id, Duration.seconds(10)));
      yield* TestClock.adjust(Duration.seconds(11));
      assert.equal((yield* Fiber.join(timedOut)).item.status, "open");
    }),
  );

  it.effect("takes the default, or expires, when expires_at passes", () =>
    Effect.gen(function* () {
      const decisions = yield* DecisionService.DecisionService;
      const now = yield* Clock.currentTimeMillis;
      const withDefault = yield* decisions.submit(
        pick({ project: "expiry", default: "b", expires_at: now + 1_000 }),
      );
      const without = yield* decisions.submit(pick({ project: "expiry", expires_at: now + 1_000 }));
      const later = yield* decisions.submit(pick({ project: "expiry", expires_at: now + 60_000 }));
      yield* TestClock.adjust(Duration.seconds(2));
      assert.equal(yield* decisions.expireDue, 2);

      const defaulted = yield* decisions.get(withDefault.id);
      assert.equal(defaulted.item.status, "answered");
      assert.equal(defaulted.answer?.decided_by, "default");
      assert.deepStrictEqual(defaulted.answer?.option_ids, ["b"]);
      assert.equal((yield* decisions.get(without.id)).item.status, "expired");
      assert.equal((yield* decisions.get(later.id)).item.status, "open");
    }),
  );
});
