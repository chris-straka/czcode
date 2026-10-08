import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { addFolderProject } from "./queue.ts";
import type { ServerClient } from "./serverClient.ts";

const fakeClient = () => {
  const created: Array<{ type: string; title: string; workspaceRoot: string }> = [];
  const client = {
    projects: {
      mutate: (request: { payload: (typeof created)[number] }) =>
        Effect.sync(() => void created.push(request.payload)),
    },
  } as unknown as ServerClient;
  return { client, created };
};
const headers = { authorization: "Bearer test" };

describe("cz queue add --project", () => {
  it.effect("adds a folder that isn't a project yet", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const folder = yield* fs.makeTempDirectoryScoped({ prefix: "cz-queue-hll-" });
      const { client, created } = fakeClient();
      const id = yield* addFolderProject(client, headers, { host: Option.none() }, folder);
      expect(id).toBeTruthy();
      expect(created).toEqual([
        expect.objectContaining({
          type: "project.create",
          workspaceRoot: folder,
          title: path.basename(folder),
        }),
      ]);
    }).pipe(Effect.scoped, Effect.provide([NodeServices.layer, NodeCrypto.layer])),
  );

  it.effect("still fails for a name that is neither a project nor a folder", () =>
    Effect.gen(function* () {
      const { client, created } = fakeClient();
      const error = yield* Effect.flip(
        addFolderProject(client, headers, { host: Option.none() }, "no-such-project-name"),
      );
      expect(error.message).toContain("No cz project or folder");
      expect(created).toEqual([]);
    }).pipe(Effect.provide([NodeServices.layer, NodeCrypto.layer])),
  );
});
