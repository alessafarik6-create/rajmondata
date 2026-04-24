/**
 * Zkopíruje DejaVu TTF z npm balíčku do public/fonts pro PDF export v prohlížeči.
 */
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(root, "node_modules", "dejavu-fonts-ttf", "ttf");
const destDir = join(root, "public", "fonts");

if (!existsSync(srcDir)) {
  console.warn("[copy-pdf-fonts] Přeskočeno — chybí dejavu-fonts-ttf (npm install).");
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
for (const f of ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"]) {
  copyFileSync(join(srcDir, f), join(destDir, f));
}
console.log("[copy-pdf-fonts] OK → public/fonts/DejaVuSans*.ttf");
