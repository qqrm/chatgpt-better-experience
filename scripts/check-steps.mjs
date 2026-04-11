export const verifySteps = [
  { name: "format:check", script: "format:check:raw" },
  { name: "lint", script: "lint:raw" },
  { name: "typecheck", script: "typecheck:raw" },
  { name: "build", script: "build:raw" }
];

export const verifyCiSteps = [
  ...verifySteps,
  { name: "test", script: "test:raw" },
  { name: "lint:amo", script: "lint:amo:raw" },
  { name: "build:amo", script: "build:amo:raw" }
];

export const findCheckStep = (steps, name) => steps.find((step) => step.name === name) ?? null;
