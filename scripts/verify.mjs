import { spawn } from "node:child_process";

const steps = ["format:check", "lint", "typecheck", "build"];

const args = process.argv.slice(2);

const parseStep = (argv) => {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--step" && i + 1 < argv.length) return String(argv[i + 1]).trim();
    if (a.startsWith("--step=")) return String(a.slice("--step=".length)).trim();
  }
  return null;
};

const step = parseStep(args);
const stepsToRun = step ? [step] : steps;

const run = (command) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command}`));
    });
  });

try {
  for (const script of stepsToRun) {
    if (!steps.includes(script)) {
      throw new Error(
        `Unknown verify step: ${script}. Allowed: ${steps.join(", ")}. ` +
          `Example: npm run verify -- --step=${steps[0]}`
      );
    }
    await run(`npm run ${script}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
