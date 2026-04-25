const INVALID = /[^a-zA-Z0-9_-]/g;

/** Deterministické ID dokumentu návrhu CSV ve Firestore (jobs/.../csvMaterialDrafts). */
export function csvMaterialDraftDocId(folderId: string, jobFolderImageId: string): string {
  const a = folderId.replace(INVALID, "_").slice(0, 200);
  const b = jobFolderImageId.replace(INVALID, "_").slice(0, 200);
  const out = `csv_${a}_${b}`;
  return out.length > 800 ? out.slice(0, 800) : out;
}
