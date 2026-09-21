import fs from "fs";
import path from "path";
import {
  getHikvisionJssdkPublicConfig,
  HIKVISION_JSSDK_DEFAULT_SCRIPT,
} from "@/lib/hikvision/jssdk-config-shared";

export type HikvisionJssdkLocalCheck = {
  mode: "local" | "external";
  expectedScriptUrl: string;
  scriptFileExists: boolean | null;
  staticDirExists: boolean | null;
  cssFileExists: boolean | null;
  missingFiles: string[];
};

function publicFileExists(relativeUnderPublic: string): boolean {
  const abs = path.join(process.cwd(), "public", relativeUnderPublic.replace(/^\//, ""));
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

function publicDirExists(relativeUnderPublic: string): boolean {
  const abs = path.join(process.cwd(), "public", relativeUnderPublic.replace(/^\//, ""));
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/** Server-side kontrola lokálních distribučních souborů (bez stahování SDK). */
export function checkHikvisionJssdkLocalFiles(): HikvisionJssdkLocalCheck {
  const cfg = getHikvisionJssdkPublicConfig();
  const scriptUrl = cfg.scriptUrl;
  const isLocal = scriptUrl.startsWith("/");

  if (!isLocal) {
    return {
      mode: "external",
      expectedScriptUrl: scriptUrl,
      scriptFileExists: null,
      staticDirExists: null,
      cssFileExists: null,
      missingFiles: [],
    };
  }

  const scriptRel = scriptUrl.replace(/^\//, "");
  const scriptFileExists = publicFileExists(scriptRel);
  const staticRel = cfg.staticPath.replace(/^\//, "");
  const staticDirExists = publicDirExists(staticRel);
  const cssRel = cfg.cssUrl?.replace(/^\//, "") ?? "";
  const cssFileExists = cssRel ? publicFileExists(cssRel) : null;

  const missingFiles: string[] = [];
  if (!scriptFileExists) {
    missingFiles.push(`public/${scriptRel}`);
  }
  if (!staticDirExists) {
    missingFiles.push(`public/${staticRel}/ (celý adresář z EZUIKit balíčku)`);
  }
  if (cfg.cssUrl && cssRel && cssFileExists === false) {
    missingFiles.push(`public/${cssRel} (volitelné dle verze SDK)`);
  }

  return {
    mode: "local",
    expectedScriptUrl: scriptUrl || HIKVISION_JSSDK_DEFAULT_SCRIPT,
    scriptFileExists,
    staticDirExists,
    cssFileExists,
    missingFiles,
  };
}
