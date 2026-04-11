export type QuietRunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type QuietRunLogger = {
  log: (message: string) => void;
  error: (message: string) => void;
};

export class QuietRunError extends Error {
  result: QuietRunResult;
}

export function buildNpmRunCommand(options: {
  script: string;
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  execPath?: string;
}): {
  command: string;
  args: string[];
};

export function runCommandQuiet(options: {
  label: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logger?: QuietRunLogger;
  verbose?: boolean;
  shell?: boolean;
}): Promise<QuietRunResult>;

export function runNpmScriptQuiet(options: {
  script: string;
  label?: string;
  extraArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logger?: QuietRunLogger;
  verbose?: boolean;
}): Promise<QuietRunResult>;
