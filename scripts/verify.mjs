import { spawn } from "node:child_process";

const steps = ["format:check", "lint", "typecheck", "test", "build", "test:e2e"];

const args = process.argv.slice(2);
const stepIndex = args.indexOf("--step");
const stepArg = stepIndex >= 0 ? args[stepIndex + 1] : null;
const step = stepArg ? stepArg.trim() : null;
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
      throw new Error(`Unknown verify step: ${script}`);
    }
    await run(`npm run ${script}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
