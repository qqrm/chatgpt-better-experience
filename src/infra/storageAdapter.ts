import { StoragePort } from "../domain/ports/storagePort";
import { isThenable } from "../lib/utils";

export type StorageAreaLike = {
  get: (
    keys: Record<string, unknown>,
    cb: (res: Record<string, unknown>) => void
  ) => void | Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>, cb: () => void) => void | Promise<void>;
};

export type StorageApi = {
  sync?: StorageAreaLike;
  local?: StorageAreaLike;
  onChanged?: {
    addListener: (
      cb: (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        areaName: string
      ) => void
    ) => void;
  };
};

export interface StorageAdapterDeps {
  storageApi: StorageApi | null | undefined;
  lastError?: () => unknown;
}

function toError(err: unknown, fallback: string) {
  return err instanceof Error ? err : new Error(fallback);
}

export function getStorageArea(storage: StorageApi | null | undefined, preferSync: boolean) {
  if (!storage) return null;
  if (preferSync && storage.sync) return storage.sync;
  if (storage.local) return storage.local;
  return null;
}

export async function storageGet<T extends Record<string, unknown>>(
  defaults: T,
  storage: StorageApi | null | undefined,
  lastError?: () => unknown
): Promise<T> {
  const areaSync = getStorageArea(storage, true);
  const areaLocal = getStorageArea(storage, false);

  const tryGet = (area: StorageAreaLike) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      try {
        const result = area.get(defaults, (res) => {
          const err = lastError?.() ?? null;
          if (err) reject(toError(err, "Storage get failed"));
          else resolve(res);
        });
        if (isThenable(result)) result.then(resolve, reject);
      } catch (err) {
        reject(toError(err, "Storage get failed"));
      }
    });

  try {
    if (areaSync) {
      const res = await tryGet(areaSync);
      return { ...defaults, ...(res || {}) };
    }
  } catch {}

  try {
    if (areaLocal) {
      const res = await tryGet(areaLocal);
      return { ...defaults, ...(res || {}) };
    }
  } catch {}

  return { ...defaults };
}

export async function storageSet(
  values: Record<string, unknown>,
  storage: StorageApi | null | undefined,
  lastError?: () => unknown
): Promise<void> {
  const areaSync = getStorageArea(storage, true);
  const areaLocal = getStorageArea(storage, false);

  const trySet = (area: StorageAreaLike) =>
    new Promise<void>((resolve, reject) => {
      try {
        const result = area.set(values, () => {
          const err = lastError?.() ?? null;
          if (err) reject(toError(err, "Storage set failed"));
          else resolve();
        });
        if (isThenable(result)) result.then(() => resolve(), reject);
      } catch (err) {
        reject(toError(err, "Storage set failed"));
      }
    });

  let syncOk = false;
  try {
    if (areaSync) {
      await trySet(areaSync);
      syncOk = true;
    }
  } catch {}

  if (!syncOk && areaLocal) {
    try {
      await trySet(areaLocal);
    } catch {}
  }
}

export function createStoragePort({ storageApi, lastError }: StorageAdapterDeps): StoragePort {
  const onChanged =
    storageApi?.onChanged && typeof storageApi.onChanged.addListener === "function"
      ? (handler: Parameters<NonNullable<StoragePort["onChanged"]>>[0]) =>
          storageApi.onChanged?.addListener(handler)
      : undefined;

  return {
    get: (defaults) => storageGet(defaults, storageApi, lastError),
    set: (values) => storageSet(values, storageApi, lastError),
    onChanged
  };
}
