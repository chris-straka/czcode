/**
 * ForkDatabase - `cz.sqlite`, the store for fork-only features (decisions,
 * the reset queue). A private SqlClient: the server's own SqlClient serves
 * upstream's `statev2.sqlite`, and keeping the files apart keeps upstream
 * merges free of migration conflicts.
 *
 * @module ForkDatabase
 */
import * as NodeSqliteClient from "@cz/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { runForkMigrations } from "./ForkMigrations.ts";

export class ForkDatabase extends Context.Service<
  ForkDatabase,
  { readonly sql: SqlClient.SqlClient }
>()("cz/forkDatabase/ForkDatabase") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const context = yield* Layer.build(
    NodeSqliteClient.layer({ filename: path.join(config.stateDir, "cz.sqlite") }),
  );
  const sql = Context.get(context, SqlClient.SqlClient);
  yield* Effect.gen(function* () {
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* runForkMigrations;
  }).pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.orDie);
  return ForkDatabase.of({ sql });
});

export const layer = Layer.effect(ForkDatabase, make);
