export type StorageChangeSet = Record<string, { oldValue?: unknown; newValue?: unknown }>;
export type StorageChangeHandler = (changes: StorageChangeSet, areaName: string) => void;

export interface StoragePort {
  get<T extends Record<string, unknown>>(defaults: T): Promise<T>;
  set(values: Record<string, unknown>): Promise<void>;
  onChanged?: (handler: StorageChangeHandler) => void;
}
