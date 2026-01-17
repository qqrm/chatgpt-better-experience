import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const sourcePath = "icons-src/icon.svg";
const targetDir = "icons";
const sizes = [16, 32, 48, 96, 128, 256];

const svg = await readFile(sourcePath, "utf8");
await mkdir(targetDir, { recursive: true });

for (const size of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: size
    }
  });
  const pngData = resvg.render().asPng();
  await writeFile(`${targetDir}/icon${size}.png`, pngData);
}
