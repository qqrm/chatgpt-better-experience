import type { StoragePort } from "../domain/ports/storagePort";
import { StorageApi, createStoragePort } from "../infra/storageAdapter";
import { initPopupController } from "./popupController";

type ExtensionLike = {
  runtime?: { lastError?: unknown };
  storage?: StorageApi;
};

const extensionApi =
  (globalThis as typeof globalThis & { browser?: ExtensionLike; chrome?: ExtensionLike }).browser ??
  (globalThis as typeof globalThis & { browser?: ExtensionLike; chrome?: ExtensionLike }).chrome;

const storageApi = extensionApi?.storage;
const lastError = () => extensionApi?.runtime?.lastError ?? null;

const storagePort: StoragePort = createStoragePort({ storageApi, lastError });

void initPopupController({ storagePort }).catch(() => {});
