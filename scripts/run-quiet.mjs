import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { hrtime } from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_VERBOSE = process.env.CBE_VERBOSE === "1";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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
  verbose = DEFAULT_VERBOSE
}) =>
  new Promise((resolve, reject) => {
    const startedAt = hrtime.bigint();
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
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
    const npmCli = [
      process.env.npm_execpath,
      path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    ].find(
      (candidate) => candidate && path.basename(candidate) === "npm-cli.js" && existsSync(candidate)
    );
    if (!npmCli) throw new Error("Cannot locate npm-cli.js; run this command through npm.");
    const args = [npmCli, "run", "--silent", script];
    if (extraArgs.length) args.push("--", ...extraArgs);
    const env = { ...(options.env ?? process.env) };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
    if (pathKey) {
      // npm restores these paths itself; retaining them across nested npm calls
      // can exceed cmd.exe's PATH length limit on Windows.
      env[pathKey] = env[pathKey]
        .split(path.delimiter)
        .filter((entry) => !/[\\/]node_modules[\\/]\.bin[\\/]?$/iu.test(entry))
        .join(path.delimiter);
    }
    return runCommandQuiet({ ...options, env, label, command: process.execPath, args });
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
