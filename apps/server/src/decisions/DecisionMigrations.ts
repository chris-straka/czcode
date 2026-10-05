/**
 * Schema for `decisions.sqlite`. Decisions keep their own database file so
 * their migrations never share numbers with upstream's `statev2.sqlite`
 * migrations (this fork merges upstream weekly).
 *
 * @module DecisionMigrations
 */
import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const initial = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The item and answer are schema-encoded JSON documents; the other columns
  // exist for filtering and ordering.
  yield* sql`
    CREATE TABLE IF NOT EXISTS decision_items (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      answered_at INTEGER,
      expires_at INTEGER,
      item_json TEXT NOT NULL,
      answer_json TEXT
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_decision_items_status ON decision_items(status, created_at)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_decision_items_project ON decision_items(project, created_at)`;
});

const loader = Migrator.fromRecord({ "1_DecisionItems": initial });

/** Brings `decisions.sqlite` up to date. Needs the decisions SqlClient. */
export const runDecisionMigrations = Migrator.make({})({ loader });
