import type { eventWithTime } from "@rrweb/types";

export type RecorderStatus = "off" | "armed" | "recording" | "ready";

export type ElementMeta = {
  tag: string;
  id?: string;
  role?: string;
  testId?: string;
  ariaLabel?: string;
  title?: string;
  text?: string;
};

export type MacroAction =
  | {
      t: number;
      kind: "click";
      selector: string;
      meta: ElementMeta;
    }
  | {
      t: number;
      kind: "input";
      selector: string;
      valueLength: number;
      meta: ElementMeta;
    }
  | {
      t: number;
      kind: "keydown";
      key: string;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      metaKey: boolean;
    };

export type LifecycleEventName =
  | "segment_start"
  | "pageshow"
  | "pagehide"
  | "beforeunload"
  | "visibilitychange"
  | "load"
  | "segment_finalize";

export type MacroLifecycleEntry = {
  t: number;
  isoTime: string;
  event: LifecycleEventName;
  url: string;
  navType: string | null;
  visibilityState: DocumentVisibilityState;
  readyState: DocumentReadyState;
  referrer: string;
  persisted?: boolean;
};

export type MacroRecorderSegment = {
  segmentId: string;
  index: number;
  startedAt: number;
  startedAtIso: string;
  endedAt: number | null;
  endedAtIso: string | null;
  pageUrl: string;
  referrer: string;
  navigationType: string | null;
  rrwebEvents: eventWithTime[];
  actions: MacroAction[];
  lifecycleTrace: MacroLifecycleEntry[];
};

export type MacroRecorderSession = {
  schemaVersion: 2;
  sessionId: string;
  createdAt: number;
  createdAtIso: string;
  stoppedAt: number | null;
  stoppedAtIso: string | null;
  userAgent: string;
  active: boolean;
  segments: MacroRecorderSegment[];
};

type MacroRecorderSessionMeta = Omit<MacroRecorderSession, "segments"> & {
  segmentIds: string[];
};

export type MacroRecorderExportPayload = {
  schemaVersion: 2;
  session: {
    sessionId: string;
    createdAt: string;
    stoppedAt: string | null;
    totalDurationMs: number;
    userAgent: string;
  };
  segments: MacroRecorderSegment[];
  meta: {
    startedAt: number;
    stoppedAt: number | null;
    segmentCount: number;
  };
};

export interface MacroRecorderPersistence {
  loadActiveSession(): Promise<MacroRecorderSession | null>;
  createSession(input: {
    sessionId: string;
    createdAt: number;
    createdAtIso: string;
    userAgent: string;
  }): Promise<MacroRecorderSession>;
  createSegment(input: {
    sessionId: string;
    segmentId: string;
    index: number;
    startedAt: number;
    startedAtIso: string;
    pageUrl: string;
    referrer: string;
    navigationType: string | null;
  }): Promise<MacroRecorderSegment>;
  appendToSegment(input: {
    sessionId: string;
    segmentId: string;
    rrwebEvents?: eventWithTime[];
    actions?: MacroAction[];
    lifecycleTrace?: MacroLifecycleEntry[];
  }): Promise<void>;
  finalizeSegment(input: {
    sessionId: string;
    segmentId: string;
    endedAt: number;
    endedAtIso: string;
  }): Promise<void>;
  stopSession(input: { sessionId: string; stoppedAt: number; stoppedAtIso: string }): Promise<void>;
  buildExport(sessionId: string): Promise<MacroRecorderExportPayload | null>;
  clearSession(sessionId: string): Promise<void>;
}

export type MacroRecorderStorageAdapter = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
};

const STORAGE_META_KEY = "macroRecorderDebugSessionMeta";
const STORAGE_SEGMENT_PREFIX = "macroRecorderDebugSessionSegment";

function getSegmentKey(sessionId: string, segmentId: string) {
  return `${STORAGE_SEGMENT_PREFIX}:${sessionId}:${segmentId}`;
}

async function loadSessionMeta(
  adapter: MacroRecorderStorageAdapter
): Promise<MacroRecorderSessionMeta | null> {
  const raw = await adapter.get(STORAGE_META_KEY);
  if (!raw || typeof raw !== "object") return null;
  const session = raw as MacroRecorderSessionMeta;
  if (session.schemaVersion !== 2 || !Array.isArray(session.segmentIds)) return null;
  return {
    ...session,
    segmentIds: [...session.segmentIds]
  };
}

export function createMacroRecorderPersistence(
  adapter: MacroRecorderStorageAdapter
): MacroRecorderPersistence {
  return {
    async loadActiveSession() {
      const sessionMeta = await loadSessionMeta(adapter);
      if (!sessionMeta?.active) return null;
      const segments = (
        await Promise.all(
          sessionMeta.segmentIds.map(async (segmentId) => {
            const raw = await adapter.get(getSegmentKey(sessionMeta.sessionId, segmentId));
            if (!raw || typeof raw !== "object") return null;
            return raw as MacroRecorderSegment;
          })
        )
      )
        .filter((segment): segment is MacroRecorderSegment => !!segment)
        .sort((a, b) => a.index - b.index);
      return {
        ...sessionMeta,
        segments
      };
    },
    async createSession(input) {
      const sessionMeta: MacroRecorderSessionMeta = {
        schemaVersion: 2,
        sessionId: input.sessionId,
        createdAt: input.createdAt,
        createdAtIso: input.createdAtIso,
        stoppedAt: null,
        stoppedAtIso: null,
        userAgent: input.userAgent,
        active: true,
        segmentIds: []
      };
      await adapter.set(STORAGE_META_KEY, sessionMeta);
      return {
        ...sessionMeta,
        segments: []
      };
    },
    async createSegment(input) {
      const sessionMeta = await loadSessionMeta(adapter);
      if (!sessionMeta || !sessionMeta.active || sessionMeta.sessionId !== input.sessionId) {
        throw new Error("Active macro recorder session not found");
      }
      const segment: MacroRecorderSegment = {
        segmentId: input.segmentId,
        index: input.index,
        startedAt: input.startedAt,
        startedAtIso: input.startedAtIso,
        endedAt: null,
        endedAtIso: null,
        pageUrl: input.pageUrl,
        referrer: input.referrer,
        navigationType: input.navigationType,
        rrwebEvents: [],
        actions: [],
        lifecycleTrace: []
      };
      await adapter.set(getSegmentKey(input.sessionId, input.segmentId), segment);
      if (!sessionMeta.segmentIds.includes(input.segmentId)) {
        sessionMeta.segmentIds.push(input.segmentId);
        await adapter.set(STORAGE_META_KEY, sessionMeta);
      }
      return segment;
    },
    async appendToSegment(input) {
      const segmentKey = getSegmentKey(input.sessionId, input.segmentId);
      const raw = await adapter.get(segmentKey);
      if (!raw || typeof raw !== "object") return;
      const segment = raw as MacroRecorderSegment;
      if (input.rrwebEvents?.length) segment.rrwebEvents.push(...input.rrwebEvents);
      if (input.actions?.length) segment.actions.push(...input.actions);
      if (input.lifecycleTrace?.length) segment.lifecycleTrace.push(...input.lifecycleTrace);
      await adapter.set(segmentKey, segment);
    },
    async finalizeSegment(input) {
      const segmentKey = getSegmentKey(input.sessionId, input.segmentId);
      const raw = await adapter.get(segmentKey);
      if (!raw || typeof raw !== "object") return;
      const segment = raw as MacroRecorderSegment;
      if (segment.endedAt !== null) return;
      segment.endedAt = input.endedAt;
      segment.endedAtIso = input.endedAtIso;
      await adapter.set(segmentKey, segment);
    },
    async stopSession(input) {
      const sessionMeta = await loadSessionMeta(adapter);
      if (!sessionMeta || sessionMeta.sessionId !== input.sessionId) return;
      sessionMeta.active = false;
      sessionMeta.stoppedAt = input.stoppedAt;
      sessionMeta.stoppedAtIso = input.stoppedAtIso;
      await adapter.set(STORAGE_META_KEY, sessionMeta);
    },
    async buildExport(sessionId) {
      const sessionMeta = await loadSessionMeta(adapter);
      if (!sessionMeta || sessionMeta.sessionId !== sessionId) return null;
      const segments = (
        await Promise.all(
          sessionMeta.segmentIds.map(async (segmentId) => {
            const raw = await adapter.get(getSegmentKey(sessionId, segmentId));
            if (!raw || typeof raw !== "object") return null;
            return raw as MacroRecorderSegment;
          })
        )
      )
        .filter((segment): segment is MacroRecorderSegment => !!segment)
        .sort((a, b) => a.index - b.index);
      const stoppedAt = sessionMeta.stoppedAt ?? null;
      return {
        schemaVersion: 2,
        session: {
          sessionId: sessionMeta.sessionId,
          createdAt: sessionMeta.createdAtIso,
          stoppedAt: sessionMeta.stoppedAtIso,
          totalDurationMs: stoppedAt ? Math.max(0, stoppedAt - sessionMeta.createdAt) : 0,
          userAgent: sessionMeta.userAgent
        },
        segments,
        meta: {
          startedAt: sessionMeta.createdAt,
          stoppedAt,
          segmentCount: segments.length
        }
      };
    },
    async clearSession(sessionId) {
      const sessionMeta = await loadSessionMeta(adapter);
      if (!sessionMeta || sessionMeta.sessionId !== sessionId) return;
      await Promise.all([
        ...sessionMeta.segmentIds.map((segmentId) =>
          adapter.remove(getSegmentKey(sessionId, segmentId))
        ),
        adapter.remove(STORAGE_META_KEY)
      ]);
    }
  };
}

export function createChromeLocalStorageAdapter(): MacroRecorderStorageAdapter {
  const chromeApi = globalThis as typeof globalThis & {
    chrome?: {
      storage?: {
        local?: {
          get(key: string): Promise<Record<string, unknown>>;
          set(values: Record<string, unknown>): Promise<void>;
          remove(key: string): Promise<void>;
        };
      };
    };
  };

  return {
    async get(key) {
      if (!chromeApi.chrome?.storage?.local) return null;
      const result = await chromeApi.chrome.storage.local.get(key);
      return result[key];
    },
    async set(key, value) {
      if (!chromeApi.chrome?.storage?.local) return;
      await chromeApi.chrome.storage.local.set({ [key]: value });
    },
    async remove(key) {
      if (!chromeApi.chrome?.storage?.local) return;
      await chromeApi.chrome.storage.local.remove(key);
    }
  };
}
