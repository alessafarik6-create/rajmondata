/**
 * Zkopíruje oficiální UMD build ezuikit-js do public/hikvision-jssdk/
 * (Vercel build / postinstall — bez ručního uploadu SDK).
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from "fs";
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
const destCss = join(destDir, "ezuikit.css");
const destCssAlias = join(destDir, "ezUIKit.css");
const destStatic = join(destDir, "ezuikit_static");
const cssStub = `/* EZUIKit v9 — styly v JS bundlu; stub pro case-sensitive produkci. */\n`;

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
writeFileSync(destCss, cssStub, "utf8");
writeFileSync(
  destCssAlias,
  '@import url("./ezuikit.css");\n',
  "utf8"
);
console.log(
  "[copy-hikvision-jssdk] OK → ezuikit.js, ezUIKit.js, ezuikit.css, ezUIKit.css, ezuikit_static/"
);
