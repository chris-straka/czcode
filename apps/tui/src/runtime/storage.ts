/**
 * Connection persistence for the TUI: saved environments, profiles, and
 * credentials in the catalog file; orchestration caches in memory (the TUI
 * reconnects quickly and keeps no offline view).
 *
 * @module storage
 */
import { TokenStore } from "@cz/client-runtime/authorization";
import {
  ConnectionTransientError,
  CredentialStore,
  GitHubRoutingPermissions,
  makeGitHubRoutingPermissions,
  ProfileStore,
} from "@cz/client-runtime/connection";
import {
  Persistence,
  putRemoteDpopTokenInCatalog,
  registerConnectionInCatalog,
  removeCatalogValue,
  removeConnectionFromCatalog,
  replaceCatalogValue,
  setConnectionEnabledInCatalog,
  setRoutesInCatalog,
} from "@cz/client-runtime/platform";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as CatalogFile from "./catalogFile.ts";

type TargetOperation =
  | "list-targets"
  | "list-disabled-targets"
  | "register-connection"
  | "set-connection-routes"
  | "remove-connection"
  | "set-connection-enabled";

const targetError = (operation: TargetOperation) => (error: ConnectionTransientError) =>
  new Persistence.ConnectionPersistenceError({ operation, message: error.message });

export const connectionStorageLayer = (configDir: string) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const catalog = yield* CatalogFile.make(configDir);
      const githubRoutingPermissions = yield* makeGitHubRoutingPermissions({
        read: catalog.read.pipe(Effect.map((document) => document.githubRoutingPermissions ?? [])),
        write: (githubRoutingPermissions) =>
          catalog.update((document) => ({ ...document, githubRoutingPermissions })),
      });
      const targetStore = Persistence.ConnectionTargetStore.of({
        list: catalog.read.pipe(
          Effect.map((document) => document.targets),
          Effect.mapError(targetError("list-targets")),
        ),
        listDisabled: catalog.read.pipe(
          Effect.map((document) => document.disabledEnvironmentIds),
          Effect.mapError(targetError("list-disabled-targets")),
        ),
      });
      const registrationStore = Persistence.ConnectionRegistrationStore.of({
        register: (registration, routes) =>
          catalog
            .update((document) => registerConnectionInCatalog(document, registration, routes))
            .pipe(Effect.mapError(targetError("register-connection"))),
        setRoutes: (environmentId, routes) =>
          catalog
            .update((document) => setRoutesInCatalog(document, environmentId, routes))
            .pipe(Effect.mapError(targetError("set-connection-routes"))),
        remove: (environmentId) =>
          catalog
            .update((document) => removeConnectionFromCatalog(document, environmentId))
            .pipe(Effect.mapError(targetError("remove-connection"))),
        setEnabled: (environmentId, enabled) =>
          catalog
            .update((document) => setConnectionEnabledInCatalog(document, environmentId, enabled))
            .pipe(Effect.mapError(targetError("set-connection-enabled"))),
      });
      const profileStore = ProfileStore.make({
        get: (connectionId) =>
          catalog.read.pipe(
            Effect.map((document) =>
              Option.fromUndefinedOr(
                document.profiles.find((candidate) => candidate.connectionId === connectionId),
              ),
            ),
          ),
        put: (profile) =>
          catalog.update((document) => ({
            ...document,
            profiles: replaceCatalogValue(
              document.profiles,
              (value) => value.connectionId,
              profile,
            ),
          })),
        remove: (connectionId) =>
          catalog.update((document) => ({
            ...document,
            profiles: removeCatalogValue(
              document.profiles,
              (value) => value.connectionId,
              connectionId,
            ),
          })),
      });
      const credentialStore = CredentialStore.make({
        get: (connectionId) =>
          catalog.read.pipe(
            Effect.map((document) =>
              Option.fromUndefinedOr(
                document.credentials.find((entry) => entry.connectionId === connectionId)
                  ?.credential,
              ),
            ),
          ),
        put: (connectionId, credential) =>
          catalog.update((document) => ({
            ...document,
            credentials: replaceCatalogValue(document.credentials, (value) => value.connectionId, {
              connectionId,
              credential,
            }),
          })),
        remove: (connectionId) =>
          catalog.update((document) => ({
            ...document,
            credentials: removeCatalogValue(
              document.credentials,
              (value) => value.connectionId,
              connectionId,
            ),
          })),
      });
      const remoteTokenStore = TokenStore.make({
        get: (environmentId) =>
          catalog.read.pipe(
            Effect.map((document) =>
              Option.fromUndefinedOr(
                document.remoteDpopTokens.find((token) => token.environmentId === environmentId),
              ),
            ),
          ),
        put: (token) => catalog.update((document) => putRemoteDpopTokenInCatalog(document, token)),
        remove: (environmentId) =>
          catalog.update((document) => ({
            ...document,
            remoteDpopTokens: removeCatalogValue(
              document.remoteDpopTokens,
              (value) => value.environmentId,
              environmentId,
            ),
          })),
      });
      return Context.make(Persistence.ConnectionTargetStore, targetStore).pipe(
        Context.add(GitHubRoutingPermissions, githubRoutingPermissions),
        Context.add(Persistence.ConnectionRegistrationStore, registrationStore),
        Context.add(ProfileStore.ConnectionProfileStore, profileStore),
        Context.add(CredentialStore.ConnectionCredentialStore, credentialStore),
        Context.add(TokenStore.RemoteDpopAccessTokenStore, remoteTokenStore),
      );
    }),
  );

/** Snapshot caches live for the session only. */
export const memoryCacheLayer = Layer.sync(Persistence.EnvironmentCacheStore, () => {
  const shells = new Map<string, unknown>();
  const threads = new Map<string, unknown>();
  const configs = new Map<string, unknown>();
  const refs = new Map<string, unknown>();
  const get = <A>(map: Map<string, unknown>, key: string) =>
    Effect.sync(() => Option.fromUndefinedOr(map.get(key) as A | undefined));
  const set = (map: Map<string, unknown>, key: string, value: unknown) =>
    Effect.sync(() => void map.set(key, value));
  const dropPrefix = (map: Map<string, unknown>, prefix: string) => {
    for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
  };
  return Persistence.EnvironmentCacheStore.of({
    loadShell: (environmentId) => get(shells, environmentId),
    saveShell: (environmentId, snapshot) => set(shells, environmentId, snapshot),
    loadThread: (environmentId, threadId) => get(threads, `${environmentId}\n${threadId}`),
    saveThread: (environmentId, snapshot) =>
      set(threads, `${environmentId}\n${snapshot.projection.thread.id}`, snapshot),
    removeThread: (environmentId, threadId) =>
      Effect.sync(() => void threads.delete(`${environmentId}\n${threadId}`)),
    loadServerConfig: (environmentId) => get(configs, environmentId),
    saveServerConfig: (environmentId, config) => set(configs, environmentId, config),
    loadVcsRefs: (environmentId, cwd) => get(refs, `${environmentId}\n${cwd}`),
    saveVcsRefs: (environmentId, cwd, value) => set(refs, `${environmentId}\n${cwd}`, value),
    removeVcsRefs: (environmentId, cwd) =>
      Effect.sync(() => void refs.delete(`${environmentId}\n${cwd}`)),
    clearVcsRefs: (environmentId) => Effect.sync(() => dropPrefix(refs, `${environmentId}\n`)),
    clear: (environmentId) =>
      Effect.sync(() => {
        shells.delete(environmentId);
        configs.delete(environmentId);
        dropPrefix(threads, `${environmentId}\n`);
        dropPrefix(refs, `${environmentId}\n`);
      }),
  });
});
