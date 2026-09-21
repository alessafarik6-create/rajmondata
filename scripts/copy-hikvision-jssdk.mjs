/**
 * Zkopíruje oficiální UMD build ezuikit-js do public/hikvision-jssdk/
 * (Vercel build / postinstall — bez ručního uploadu SDK).
 */
import { copyFileSync, cpSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const pkgRoot = join(root, "node_modules", "ezuikit-js");
const srcJs = join(pkgRoot, "ezuikit.js");
const srcStatic = join(pkgRoot, "ezuikit_static");
const destDir = join(root, "public", "hikvision-jssdk");
const destJs = join(destDir, "ezuikit.js");
const destJsAlias = join(destDir, "ezUIKit.js");
const destStatic = join(destDir, "ezuikit_static");

if (!existsSync(srcJs)) {
  console.warn("[copy-hikvision-jssdk] Přeskočeno — není nainstalován ezuikit-js.");
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(srcJs, destJs);
copyFileSync(srcJs, destJsAlias);
if (existsSync(srcStatic)) {
  cpSync(srcStatic, destStatic, { recursive: true });
}
console.log("[copy-hikvision-jssdk] OK → public/hikvision-jssdk/ezuikit.js + ezUIKit.js + ezuikit_static/");
