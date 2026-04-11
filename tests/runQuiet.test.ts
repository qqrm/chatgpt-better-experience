import { describe, expect, it, vi } from "vitest";

import { QuietRunError, buildNpmRunCommand, runCommandQuiet } from "../scripts/run-quiet.mjs";

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

describe("buildNpmRunCommand", () => {
  it("uses a shell-free npm CLI invocation on Windows", () => {
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const npmCliPath = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

    expect(
      buildNpmRunCommand({
        script: "build:raw",
        extraArgs: ["--flag", "spaced value"],
        platform: "win32",
        execPath,
        env: {
          npm_execpath: npmCliPath
        }
      })
    ).toEqual({
      command: execPath,
      args: [npmCliPath, "run", "--silent", "build:raw", "--", "--flag", "spaced value"]
    });
  });

  it("uses npm directly on non-Windows platforms", () => {
    expect(
      buildNpmRunCommand({
        script: "test:raw",
        extraArgs: ["--runInBand"],
        platform: "linux"
      })
    ).toEqual({
      command: "npm",
      args: ["run", "--silent", "test:raw", "--", "--runInBand"]
    });
  });
});
