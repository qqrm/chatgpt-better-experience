import { describe, expect, it } from "vitest";
import { createMessageTimestampRepository } from "../src/features/messageTimestamps.repo";

function createMemoryArea(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    area: {
      get: async (defaults: Record<string, unknown>) => ({
        ...defaults,
        ...data
      }),
      set: async (values: Record<string, unknown>) => {
        Object.assign(data, values);
      }
    }
  };
}

describe("message timestamp repository", () => {
  it("stores and reloads user + assistant timestamps", async () => {
    const memory = createMemoryArea();
    const repo = createMessageTimestampRepository({
      localArea: memory.area,
      now: () => 1700000000000
    });

    await repo.upsertMessage("conv-1", "user-1", { role: "user", sentAt: 1700000000001 });
    await repo.upsertMessage("conv-1", "assistant-1", {
      role: "assistant",
      completedAt: 1700000000999
    });

    const reloaded = createMessageTimestampRepository({
      localArea: memory.area,
      now: () => 1700000000000
    });
    const conversation = await reloaded.getConversation("conv-1");

    expect(conversation?.messages["user-1"]).toEqual({
      role: "user",
      sentAt: 1700000000001
    });
    expect(conversation?.messages["assistant-1"]).toEqual({
      role: "assistant",
      completedAt: 1700000000999
    });
  });

  it("prunes old conversations and old messages", async () => {
    const memory = createMemoryArea();
    let nowMs = 1000;
    const repo = createMessageTimestampRepository({
      localArea: memory.area,
      now: () => nowMs,
      maxConversations: 1,
      maxMessagesPerConversation: 2
    });

    await repo.upsertMessage("conv-old", "m1", { role: "user", sentAt: 1 });
    nowMs = 2000;
    await repo.upsertMessage("conv-old", "m2", { role: "assistant", completedAt: 2 });
    nowMs = 3000;
    await repo.upsertMessage("conv-old", "m3", { role: "assistant", completedAt: 3 });
    nowMs = 4000;
    await repo.upsertMessage("conv-new", "m4", { role: "user", sentAt: 4 });

    const reloaded = createMessageTimestampRepository({
      localArea: memory.area,
      now: () => nowMs
    });

    expect(await reloaded.getConversation("conv-old")).toBeNull();
    const newestConversation = await reloaded.getConversation("conv-new");
    expect(Object.keys(newestConversation?.messages ?? {})).toEqual(["m4"]);
  });
});
