import { verifyCiSteps } from "./check-steps.mjs";
import { QuietRunError, runNpmScriptQuiet } from "./run-quiet.mjs";

try {
  for (const step of verifyCiSteps) {
    await runNpmScriptQuiet({
      label: step.name,
      script: step.script
    });
  }
} catch (error) {
  if (!(error instanceof QuietRunError)) {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
}
