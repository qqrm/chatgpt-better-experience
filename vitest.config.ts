import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.e2e.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/application/**/*UseCases.ts",
        "src/application/wideChat.ts",
        "src/features/chatgptEditor.ts",
        "src/features/ctrlEnterSend.ts",
        "src/features/keyCombos.ts",
        "src/infra/storageAdapter.ts",
        "src/lib/utils.ts"
      ],
      exclude: ["src/features/dictationAutoSend.ts", "src/features/oneClickDelete.ts"],
      thresholds: {
        lines: 70,
        functions: 65
      }
    }
  }
});
