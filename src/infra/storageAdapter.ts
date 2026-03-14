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

async function getFromArea<T extends Record<string, unknown>>(
  area: StorageAreaLike | null,
  defaults: T,
  lastError?: () => unknown
): Promise<T> {
  if (!area) return { ...defaults };

  const res = await new Promise<Record<string, unknown>>((resolve, reject) => {
    try {
      const result = area.get(defaults, (next) => {
        const err = lastError?.() ?? null;
        if (err) reject(toError(err, "Storage get failed"));
        else resolve(next);
      });
      if (isThenable(result)) result.then(resolve, reject);
    } catch (err) {
      reject(toError(err, "Storage get failed"));
    }
  });

  return { ...defaults, ...(res || {}) };
}

async function setToArea(
  area: StorageAreaLike | null,
  values: Record<string, unknown>,
  lastError?: () => unknown
): Promise<void> {
  if (!area) return;

  await new Promise<void>((resolve, reject) => {
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
}

export async function storageGet<T extends Record<string, unknown>>(
  defaults: T,
  storage: StorageApi | null | undefined,
  lastError?: () => unknown
): Promise<T> {
  const areaSync = getStorageArea(storage, true);
  const areaLocal = getStorageArea(storage, false);

  try {
    if (areaSync) {
      return await getFromArea(areaSync, defaults, lastError);
    }
  } catch {}

  try {
    if (areaLocal) {
      return await getFromArea(areaLocal, defaults, lastError);
    }
  } catch {}

  return { ...defaults };
}

export async function storageGetLocal<T extends Record<string, unknown>>(
  defaults: T,
  storage: StorageApi | null | undefined,
  lastError?: () => unknown
): Promise<T> {
  try {
    return await getFromArea(getStorageArea(storage, false), defaults, lastError);
  } catch {
    return { ...defaults };
  }
}

export async function storageSet(
  values: Record<string, unknown>,
  storage: StorageApi | null | undefined,
  lastError?: () => unknown
): Promise<void> {
  const areaSync = getStorageArea(storage, true);
  const areaLocal = getStorageArea(storage, false);

  let syncOk = false;
  try {
    if (areaSync) {
      await setToArea(areaSync, values, lastError);
      syncOk = true;
    }
  } catch {}

  if (!syncOk && areaLocal) {
    try {
      await setToArea(areaLocal, values, lastError);
    } catch {}
  }
}

export async function storageSetLocal(
  values: Record<string, unknown>,
  storage: StorageApi | null | undefined,
  lastError?: () => unknown
): Promise<void> {
  try {
    await setToArea(getStorageArea(storage, false), values, lastError);
  } catch {}
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
    getLocal: (defaults) => storageGetLocal(defaults, storageApi, lastError),
    setLocal: (values) => storageSetLocal(values, storageApi, lastError),
    onChanged
  };
}
