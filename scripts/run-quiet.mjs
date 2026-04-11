import { spawn } from "node:child_process";
import { hrtime } from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_VERBOSE = process.env.CBE_VERBOSE === "1";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const windowsShell = process.env.ComSpec ?? "cmd.exe";

const formatDuration = (durationMs) => {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
};

const quoteArg = (value) => {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return JSON.stringify(value);
};

const formatCommand = (command, args) => [command, ...args].map(quoteArg).join(" ");

const printCapturedOutput = (logger, streamName, content) => {
  const trimmed = content.trim();
  if (!trimmed) {
    return;
  }

  logger.error(`${streamName}:`);
  logger.error(trimmed);
};

export class QuietRunError extends Error {
  constructor(message, result) {
    super(message);
    this.name = "QuietRunError";
    this.result = result;
  }
}

export const runCommandQuiet = ({
  label,
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  logger = console,
  verbose = DEFAULT_VERBOSE,
  shell = false
}) =>
  new Promise((resolve, reject) => {
    const startedAt = hrtime.bigint();
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env,
      shell,
      stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    if (!verbose) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;

      const durationMs = Number(hrtime.bigint() - startedAt) / 1_000_000;
      const result = {
        code: null,
        signal: null,
        stdout,
        stderr,
        durationMs
      };

      if (!verbose) {
        logger.error(`[fail] ${label} (${formatDuration(durationMs)})`);
        logger.error(`$ ${formatCommand(command, args)}`);
        printCapturedOutput(logger, "stdout", stdout);
        printCapturedOutput(logger, "stderr", stderr);
      }

      reject(new QuietRunError(error.message, result));
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;

      const durationMs = Number(hrtime.bigint() - startedAt) / 1_000_000;
      const result = {
        code,
        signal,
        stdout,
        stderr,
        durationMs
      };

      if (code === 0) {
        if (!verbose) {
          logger.log(`[pass] ${label} (${formatDuration(durationMs)})`);
        }

        resolve(result);
        return;
      }

      if (!verbose) {
        const exitDetail = signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`;
        logger.error(`[fail] ${label} (${formatDuration(durationMs)})`);
        logger.error(`$ ${formatCommand(command, args)} (${exitDetail})`);
        printCapturedOutput(logger, "stdout", stdout);
        printCapturedOutput(logger, "stderr", stderr);
      }

      reject(new QuietRunError(`Command failed: ${label}`, result));
    });
  });

export const runNpmScriptQuiet = ({ script, label = script, extraArgs = [], ...options }) => {
  if (process.platform === "win32") {
    const forwardedArgs = extraArgs.length > 0 ? ` -- ${extraArgs.map(quoteArg).join(" ")}` : "";

    return runCommandQuiet({
      ...options,
      label,
      command: windowsShell,
      args: ["/d", "/s", "/c", `${npmCommand} run --silent ${script}${forwardedArgs}`]
    });
  }

  const npmArgs = ["run", "--silent", script];
  if (extraArgs.length > 0) {
    npmArgs.push("--", ...extraArgs);
  }

  return runCommandQuiet({
    ...options,
    label,
    command: npmCommand,
    args: npmArgs
  });
};

const parseCliArgs = (argv) => {
  let label = "";
  let script = "";
  const extraArgs = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--label" && i + 1 < argv.length) {
      label = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }

    if (arg.startsWith("--label=")) {
      label = String(arg.slice("--label=".length)).trim();
      continue;
    }

    if (arg === "--script" && i + 1 < argv.length) {
      script = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }

    if (arg.startsWith("--script=")) {
      script = String(arg.slice("--script=".length)).trim();
      continue;
    }

    extraArgs.push(arg);
  }

  return { label, script, extraArgs };
};

const runCli = async () => {
  const { label, script, extraArgs } = parseCliArgs(process.argv.slice(2));
  if (!label || !script) {
    throw new Error("Usage: node scripts/run-quiet.mjs --label <label> --script <npm-script>");
  }

  await runNpmScriptQuiet({ label, script, extraArgs });
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await runCli();
  } catch (error) {
    if (!(error instanceof QuietRunError)) {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exit(1);
  }
}
