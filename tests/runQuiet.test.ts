import { describe, expect, it, vi } from "vitest";

import { QuietRunError, runCommandQuiet } from "../scripts/run-quiet.mjs";

describe("runCommandQuiet", () => {
  it("prints only a pass summary on success", async () => {
    const logger = {
      log: vi.fn(),
      error: vi.fn()
    };

    await runCommandQuiet({
      label: "fixture-success",
      command: process.execPath,
      args: ["-e", 'console.log("hidden success output")'],
      logger
    });

    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log.mock.calls[0]?.[0]).toContain("[pass] fixture-success");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("prints captured stdout and stderr when the command fails", async () => {
    const logger = {
      log: vi.fn(),
      error: vi.fn()
    };

    await expect(
      runCommandQuiet({
        label: "fixture-failure",
        command: process.execPath,
        args: [
          "-e",
          'console.log("captured stdout"); console.error("captured stderr"); process.exit(1);'
        ],
        logger
      })
    ).rejects.toBeInstanceOf(QuietRunError);

    const errorLines = logger.error.mock.calls.map(([value]) => String(value));
    expect(errorLines.some((line) => line.includes("[fail] fixture-failure"))).toBe(true);
    expect(errorLines.some((line) => line.includes("stdout:"))).toBe(true);
    expect(errorLines.some((line) => line.includes("captured stdout"))).toBe(true);
    expect(errorLines.some((line) => line.includes("stderr:"))).toBe(true);
    expect(errorLines.some((line) => line.includes("captured stderr"))).toBe(true);
  });
});
