/**
 * Podklady pro výrobní detail — URL souborů ve složkách zakázky a pravidla viditelnosti složek.
 */

export type ProductionFolderRow = {
  id: string;
  name?: string;
  type?: string;
  productionTeamVisible?: boolean;
  employeeVisible?: boolean;
  employeeVisibility?: string;
  internalOnly?: boolean;
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

/**
 * Složky zakázky k načtení podkladů ve výrobě.
 * - Typ „dokumenty“ nikdy (smlouvy / účetní).
 * - Vedení: všechny technické složky.
 * - Jinak: složka se značkou „Výroba“, nebo zaškrtnutá v productionVisibleFolderIds,
 *   nebo (fotky/soubory) viditelné zaměstnanci a ne interní-only.
 */
export function filterFoldersForProductionView(
  folders: unknown[],
  opts: {
    visibleFolderPick: Set<string>;
    isPrivilegedViewer: boolean;
  }
): ProductionFolderRow[] {
  const { visibleFolderPick, isPrivilegedViewer } = opts;
  const list = Array.isArray(folders) ? folders : [];
  const rows = list.filter(
    (f): f is ProductionFolderRow =>
      !!f && typeof f === "object" && typeof (f as { id?: unknown }).id === "string"
  );

  return rows
    .filter((f) => String(f.type || "").toLowerCase() !== "documents")
    .filter((f) => {
      if (isPrivilegedViewer) return true;
      const pick = visibleFolderPick;
      const inPick = pick.size > 0 && pick.has(f.id);
      const prod = f.productionTeamVisible === true;
      const empVis =
        f.employeeVisible === true || String(f.employeeVisibility || "").trim() === "employee_visible";
      const internal = f.internalOnly === true;
      const t = String(f.type || "").toLowerCase();
      const technicalType = t === "photos" || t === "files" || t === "";

      if (pick.size === 0) {
        if (prod) return true;
        if (internal) return false;
        return empVis && technicalType;
      }
      if (prod) return true;
      if (inPick) return true;
      if (internal) return false;
      return empVis && technicalType;
    })
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "cs"));
}
