import { describe, expect, it } from "vitest";
import { SETTINGS_DEFAULTS } from "../settings";
import { StorageAreaLike, StorageApi, storageGet, storageSet } from "../src/infra/storageAdapter";

type MemoryArea = {
  data: Record<string, unknown>;
  area: StorageAreaLike;
};

const createMemoryArea = (initial: Record<string, unknown>, shouldSucceed = true): MemoryArea => {
  const data = { ...initial };
  const area: StorageAreaLike = {
    get: (keys, cb) => {
      const res = Object.fromEntries(
        Object.keys(keys)
          .filter((key) => Object.prototype.hasOwnProperty.call(data, key))
          .map((key) => [key, data[key]])
      ) as Record<string, unknown>;
      cb(res);
    },
    set: (values, cb) => {
      if (shouldSucceed) {
        Object.assign(data, values);
      }
      cb();
    }
  };
  return { data, area };
};

describe("storage helpers", () => {
  it("reads from sync and merges defaults", async () => {
    const sync = createMemoryArea({ autoSend: false });
    const storage: StorageApi = { sync: sync.area };

    const res = await storageGet(SETTINGS_DEFAULTS, storage, () => null);

    expect(res.autoSend).toBe(false);
    expect(res.allowAutoSendInCodex).toBe(SETTINGS_DEFAULTS.allowAutoSendInCodex);
  });

  it("falls back to local when sync read fails", async () => {
    const sync = createMemoryArea({ autoSend: false });
    const local = createMemoryArea({ autoSend: true });
    const storage: StorageApi = { sync: sync.area, local: local.area };

    const errors: Array<unknown> = [new Error("sync failed"), null];
    const lastError = () => errors.shift() ?? null;

    const res = await storageGet(SETTINGS_DEFAULTS, storage, lastError);

    expect(res.autoSend).toBe(true);
    expect(res.allowAutoSendInCodex).toBe(SETTINGS_DEFAULTS.allowAutoSendInCodex);
  });

  it("writes to local when sync set fails", async () => {
    const sync = createMemoryArea({}, false);
    const local = createMemoryArea({});
    const storage: StorageApi = { sync: sync.area, local: local.area };

    const errors: Array<unknown> = [new Error("sync failed"), null];
    const lastError = () => errors.shift() ?? null;

    await storageSet({ autoSend: false }, storage, lastError);

    expect(sync.data.autoSend).toBeUndefined();
    expect(local.data.autoSend).toBe(false);
  });

  it("returns defaults when storage is unavailable", async () => {
    const res = await storageGet(SETTINGS_DEFAULTS, null, () => null);

    expect(res).toEqual(SETTINGS_DEFAULTS);
  });
});
