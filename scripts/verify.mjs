import { findCheckStep, verifySteps } from "./check-steps.mjs";
import { QuietRunError, runNpmScriptQuiet } from "./run-quiet.mjs";

const steps = verifySteps.map((stepDefinition) => stepDefinition.name);

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

try {
  for (const stepName of stepsToRun) {
    const stepDefinition = findCheckStep(verifySteps, stepName);
    if (!stepDefinition) {
      throw new Error(
        `Unknown verify step: ${stepName}. Allowed: ${steps.join(", ")}. ` +
          `Example: npm run verify -- --step=${steps[0]}`
      );
    }

    await runNpmScriptQuiet({
      label: stepDefinition.name,
      script: stepDefinition.script
    });
  }
} catch (error) {
  if (!(error instanceof QuietRunError)) {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
}
