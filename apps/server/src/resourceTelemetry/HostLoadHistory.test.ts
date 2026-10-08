import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ForkDatabase from "../forkDatabase/ForkDatabase.ts";
import * as HostLoadHistory from "./HostLoadHistory.ts";

const TestLayer = HostLoadHistory.serviceLayer.pipe(
  Layer.provideMerge(ForkDatabase.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "cz-host-load-" })),
  Layer.provideMerge(NodeServices.layer),
);

const MINUTE = 60_000;
const START = Date.parse("2026-10-08T00:00:00Z");
const GB = 1024 ** 3;

describe("parseNvidiaSmiUtilization", () => {
  it("averages every GPU's percentage", () => {
    assert.equal(HostLoadHistory.parseNvidiaSmiUtilization("40\n80\n"), 0.6);
  });

  it("is null without a reading", () => {
    assert.isNull(HostLoadHistory.parseNvidiaSmiUtilization(""));
    assert.isNull(
      HostLoadHistory.parseNvidiaSmiUtilization("NVIDIA-SMI has failed because it couldn't"),
    );
  });
});

describe("HostLoadHistory", () => {
  it.layer(TestLayer)((it) => {
    it.effect("averages and peaks each bucket, leaving gaps where the host was off", () =>
      Effect.gen(function* () {
        const history = yield* HostLoadHistory.HostLoadHistory;
        // Bucket 0: two samples. Bucket 1: none (machine off). Bucket 2: one.
        yield* history.record({
          sampledAt: START,
          cpu: 0.2,
          memoryUsedBytes: 4 * GB,
          gpu: null,
        });
        yield* history.record({
          sampledAt: START + MINUTE,
          cpu: 0.6,
          memoryUsedBytes: 8 * GB,
          gpu: null,
        });
        yield* history.record({
          sampledAt: START + 25 * MINUTE,
          cpu: 1,
          memoryUsedBytes: 6 * GB,
          gpu: 0.5,
        });

        const result = yield* history.read({
          sinceMs: START,
          untilMs: START + 30 * MINUTE,
          buckets: 3,
        });

        assert.equal(result.firstSampleAt, START);
        assert.equal(result.buckets.length, 3);
        assert.deepStrictEqual(result.buckets[0], {
          avgCpu: 0.4,
          peakCpu: 0.6,
          avgMemoryBytes: 6 * GB,
          peakMemoryBytes: 8 * GB,
          avgGpu: null,
          peakGpu: null,
        });
        assert.isNull(result.buckets[1]);
        assert.equal(result.buckets[2]?.avgGpu, 0.5);
        // The summary weighs samples, not buckets.
        assert.closeTo(result.summary?.avgCpu ?? 0, 0.6, 1e-9);
        assert.equal(result.summary?.peakCpu, 1);
        assert.equal(result.summary?.peakMemoryBytes, 8 * GB);
        assert.equal(result.summary?.avgGpu, 0.5);
      }),
    );

    it.effect("has no summary for a range before the first sample", () =>
      Effect.gen(function* () {
        const history = yield* HostLoadHistory.HostLoadHistory;
        const result = yield* history.read({
          sinceMs: START - 60 * MINUTE,
          untilMs: START - 30 * MINUTE,
          buckets: 2,
        });
        assert.isNull(result.summary);
        assert.deepStrictEqual(result.buckets, [null, null]);
      }),
    );

    it.effect("drops samples older than the retention window", () =>
      Effect.gen(function* () {
        const history = yield* HostLoadHistory.HostLoadHistory;
        const later = START + HostLoadHistory.RETENTION_MS + 30 * MINUTE;
        yield* history.record({ sampledAt: later, cpu: 0.1, memoryUsedBytes: GB, gpu: null });
        const result = yield* history.read({ sinceMs: 0, untilMs: later + 1, buckets: 1 });
        assert.equal(result.firstSampleAt, later);
      }),
    );
  });
});
