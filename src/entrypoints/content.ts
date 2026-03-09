import { startContentScript } from "../application/contentScript";
import { StorageApi, createStoragePort } from "../infra/storageAdapter";
import { StoragePort } from "../domain/ports/storagePort";

declare const chrome: {
  runtime?: { lastError?: unknown };
  storage?: StorageApi;
};

declare const browser: {
  storage?: StorageApi;
};

const storageApi = (
  (typeof browser !== "undefined" ? browser : chrome) as { storage?: StorageApi } | undefined
)?.storage;

const lastError = () => chrome?.runtime?.lastError ?? null;

const storagePort: StoragePort = createStoragePort({ storageApi, lastError });

startContentScript({ storagePort });
