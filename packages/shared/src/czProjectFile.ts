import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { CzProjectFile, CZ_PROJECT_FILE_SCHEMA_URL } from "@cz/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `cz.json` file contents (lenient JSONC string) and the
 * decoded {@link CzProjectFile}.
 */
export const CzProjectFileFromJson = fromLenientJson(CzProjectFile);

const decodeCzProjectFile = Schema.decodeExit(CzProjectFileFromJson);

/**
 * Decode raw `cz.json` contents, treating invalid or malformed files as
 * absent. Clients use this to read optional defaults (scripts, thread env
 * mode) without surfacing decode errors to the user.
 */
export function parseCzProjectFile(contents: string): CzProjectFile | null {
  const decoded = decodeCzProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * Build the publishable JSON Schema document for `cz.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link CZ_PROJECT_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildCzProjectFileJsonSchema(): Record<string, unknown> {
  // Closed objects, as before effect rc.113 changed the generator default;
  // editors then flag unknown keys in cz.json.
  const document = Schema.toJsonSchemaDocument(CzProjectFile, { onExcessProperty: "error" });
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: CZ_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
