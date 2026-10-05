/**
 * Product analytics, switched off. czcode sends no telemetry anywhere; the
 * service stays so call sites shared with upstream keep compiling, and every
 * event is dropped where it is recorded.
 *
 * @module AnalyticsService
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    /** Record an anonymous event. Dropped: nothing leaves the machine. */
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<void>;

    /** Flush queued events. Nothing is ever queued. */
    readonly flush: Effect.Effect<void>;
  }
>()("cz/telemetry/AnalyticsService") {
  static readonly layerTest = Layer.succeed(
    AnalyticsService,
    AnalyticsService.of({
      record: () => Effect.void,
      flush: Effect.void,
    }),
  );
}

export const layer = AnalyticsService.layerTest;
