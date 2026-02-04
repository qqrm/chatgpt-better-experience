import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadFixtureHtml(relPathFromRepoRoot: string): string {
  const p = resolve(process.cwd(), relPathFromRepoRoot);
  return readFileSync(p, "utf8");
}

export function mountHtml(html: string): void {
  document.open();
  document.write(html);
  document.close();
}
