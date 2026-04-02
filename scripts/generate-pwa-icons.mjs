import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const svgPath = path.join(root, "src", "app", "icon.svg");
const publicDir = path.join(root, "public");

async function main() {
  const svg = fs.readFileSync(svgPath);
  await fs.promises.mkdir(publicDir, { recursive: true });
  for (const size of [192, 512]) {
    const out = path.join(publicDir, `pwa-${size}.png`);
    await sharp(svg).resize(size, size).png().toFile(out);
    console.log("wrote", out);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
