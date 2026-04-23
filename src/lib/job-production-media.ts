/**
 * Podklady pro výrobní detail — URL souborů ve složkách zakázky a pravidla viditelnosti složek.
 * Zaměstnanec: jen složky explicitně viditelné pro zaměstnance + určené pro výrobu; bez „dokumentů“ a interních.
 */

import { isFolderEmployeeVisible, isImageEmployeeVisible } from "@/lib/job-employee-access";

export type ProductionFolderRow = {
  id: string;
  name?: string;
  type?: string;
  productionTeamVisible?: boolean;
  employeeVisible?: boolean;
  employeeVisibility?: string;
  internalOnly?: boolean;
  /** Synonyma / legacy pole z UI nebo importů */
  visibleToEmployees?: boolean;
  visibleInProduction?: boolean;
  internal_only?: boolean;
  employee_visibility?: string;
  visibleToCustomer?: boolean;
  folderType?: string;
  category?: string;
};

/**
 * Stejné pole jako u nahrávání v JobMediaSection — legacy záznamy mají často `imageUrl` / `downloadURL`.
 */
export function resolveJobFolderImageDownloadUrl(row: Record<string, unknown>): string {
  const candidates = [
    row.fileUrl,
    row.imageUrl,
    row.url,
    row.downloadURL,
    row.originalImageUrl,
    row.annotatedImageUrl,
  ];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s) return s;
  }
  return "";
}

function asRecord(f: ProductionFolderRow): Record<string, unknown> {
  return f as unknown as Record<string, unknown>;
}

export function readFolderInternalOnly(folder: ProductionFolderRow): boolean {
  const o = asRecord(folder);
  if (o.internalOnly === true) return true;
  if (o.internal_only === true) return true;
  return false;
}

/** Složka je pro výrobu výslovně označená (příznak na složce nebo výběr v nastavení zakázky). */
export function isFolderDesignatedForProduction(
  folder: ProductionFolderRow,
  visibleFolderPick: Set<string>
): boolean {
  const o = asRecord(folder);
  if (folder.productionTeamVisible === true) return true;
  if (o.visibleInProduction === true) return true;
  if (visibleFolderPick.size > 0 && visibleFolderPick.has(folder.id)) return true;
  return false;
}

/** Typ „doklady“ = obchodní / účetní — ve výrobě nikdy. */
function isDocumentsFolderType(folder: ProductionFolderRow): boolean {
  const t = String(folder.type ?? folder.folderType ?? folder.category ?? "")
    .trim()
    .toLowerCase();
  return t === "documents" || t === "document" || t === "faktury" || t === "invoices";
}

export type ProductionFolderFilterDebug = {
  jobId?: string;
  roleLabel: string;
  totalFolders: number;
  acceptedIds: string[];
  rejected: { id: string; name?: string; reason: string }[];
};

/**
 * Složky zakázky k načtení podkladů ve výrobě.
 * - Vedení (privileged): vše kromě typu dokladů (bezpečnost).
 * - Zaměstnanec: employee viditelnost + žádné internalOnly + musí být určena pro výrobu (příznak nebo výběr).
 */
export function filterFoldersForProductionView(
  folders: unknown[],
  opts: {
    visibleFolderPick: Set<string>;
    isPrivilegedViewer: boolean;
    jobId?: string;
    roleLabel?: string;
    debugLog?: boolean;
  }
): ProductionFolderRow[] {
  const { visibleFolderPick, isPrivilegedViewer, jobId, roleLabel, debugLog } = opts;
  const list = Array.isArray(folders) ? folders : [];
  const rows = list.filter(
    (f): f is ProductionFolderRow =>
      !!f && typeof f === "object" && typeof (f as { id?: unknown }).id === "string"
  );

  const rejected: ProductionFolderFilterDebug["rejected"] = [];
  const accepted: ProductionFolderRow[] = [];

  for (const f of rows) {
    if (isDocumentsFolderType(f)) {
      if (debugLog) rejected.push({ id: f.id, name: f.name, reason: "typ_doklady" });
      continue;
    }
    if (isPrivilegedViewer) {
      accepted.push(f);
      continue;
    }

    if (readFolderInternalOnly(f)) {
      rejected.push({ id: f.id, name: f.name, reason: "internal_only" });
      continue;
    }
    if (!isFolderEmployeeVisible(asRecord(f))) {
      rejected.push({ id: f.id, name: f.name, reason: "not_visible_to_employees" });
      continue;
    }
    if (!isFolderDesignatedForProduction(f, visibleFolderPick)) {
      rejected.push({ id: f.id, name: f.name, reason: "not_production_designated" });
      continue;
    }
    accepted.push(f);
  }

  const sorted = accepted.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "cs"));

  if (debugLog && typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    const dbg: ProductionFolderFilterDebug = {
      jobId,
      roleLabel: roleLabel ?? (isPrivilegedViewer ? "privileged" : "employee"),
      totalFolders: rows.length,
      acceptedIds: sorted.map((x) => x.id),
      rejected,
    };
    console.debug("[Vyroba] filterFoldersForProductionView", dbg);
  }

  return sorted;
}

/** Viditelnost jednoho souboru ve složce pro výrobní náhled (zaměstnanec vs vedení). */
export function isJobImageVisibleInProductionView(
  folder: ProductionFolderRow,
  imageRow: Record<string, unknown>,
  isPrivilegedViewer: boolean
): boolean {
  if (isPrivilegedViewer) {
    const lk = String(imageRow.ledgerKind ?? "").toLowerCase();
    if (lk === "income" || lk === "expense") return false;
    return true;
  }
  if (imageRow.internalOnly === true || imageRow.internal_only === true) return false;
  const lk = String(imageRow.ledgerKind ?? "").toLowerCase();
  if (lk === "income" || lk === "expense") return false;
  return isImageEmployeeVisible(asRecord(folder), imageRow);
}
