import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as MobileReleaseService from "./MobileReleaseService.ts";

const TestLayer = MobileReleaseService.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "cz-mobile-release-" })),
  Layer.provideMerge(NodeServices.layer),
);

it("reads version and versionCode from published APK names", () => {
  assert.deepStrictEqual(MobileReleaseService.parseApkName("czcode-2.0.0-812.apk"), {
    version: "2.0.0",
    versionCode: 812,
  });
  assert.isNull(MobileReleaseService.parseApkName("czcode-2.0.0.apk"));
  assert.isNull(MobileReleaseService.parseApkName("../czcode-2.0.0-1.apk"));
});

it.layer(TestLayer)("MobileReleaseService", (it) => {
  it.effect("offers the highest versionCode and only serves published APKs", () =>
    Effect.gen(function* () {
      const releases = yield* MobileReleaseService.MobileReleaseService;
      assert.isTrue(Option.isNone(yield* releases.latestAndroid));

      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.join(config.baseDir, "releases", "android");
      yield* fs.makeDirectory(dir, { recursive: true });
      yield* fs.writeFileString(path.join(dir, "czcode-2.0.0-9.apk"), "old");
      yield* fs.writeFileString(path.join(dir, "czcode-2.0.0-10.apk"), "newer");
      yield* fs.writeFileString(path.join(dir, "notes.txt"), "not an apk");

      const latest = yield* releases.latestAndroid;
      assert.deepStrictEqual(Option.getOrNull(latest), {
        file: "czcode-2.0.0-10.apk",
        version: "2.0.0",
        versionCode: 10,
        sizeBytes: 5,
      });
      assert.isTrue(Option.isSome(yield* releases.androidPath("czcode-2.0.0-9.apk")));
      assert.isTrue(Option.isNone(yield* releases.androidPath("notes.txt")));
      assert.isTrue(Option.isNone(yield* releases.androidPath("czcode-2.0.0-11.apk")));
    }),
  );
});
