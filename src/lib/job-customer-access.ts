/**
 * Přístup zákazníka (klientský portál) k zakázkám a médiím.
 * Výchozí: bez explicitního customerVisible se obsah považuje za interní.
 */

export type CustomerUserProfileLike = {
  role?: string;
  uid?: string;
  /** Firestore users — přiřazené zakázky (merge-only pole) */
  linkedJobIds?: string[];
  /** Volitelná vazba na companies/{id}/customers/{id} */
  customerRecordId?: string;
};

/**
 * Zákazník má přístup k zakázce, pokud:
 * - je v profile.linkedJobIds, nebo
 * - job.customerPortalUserIds obsahuje uid, nebo (legacy) job.customerId === uid, nebo
 * - job.customerAccessEnabled a job.customerId odpovídá profilu (CRM id)
 */
export function canCustomerAccessJob(
  userId: string,
  profile: CustomerUserProfileLike | null | undefined,
  job: Record<string, unknown> & { id?: string }
): boolean {
  if (!userId || !profile || profile.role !== "customer") return false;

  const jobId = typeof job.id === "string" ? job.id : "";
  const linked = Array.isArray(profile.linkedJobIds)
    ? profile.linkedJobIds.filter((x): x is string => typeof x === "string")
    : [];
  if (jobId && linked.includes(jobId)) return true;

  const portalIds = Array.isArray((job as { customerPortalUserIds?: unknown }).customerPortalUserIds)
    ? ((job as { customerPortalUserIds: unknown[] }).customerPortalUserIds as unknown[]).filter(
        (x): x is string => typeof x === "string"
      )
    : [];
  if (portalIds.includes(userId)) return true;

  const legacyUid =
    typeof job.customerId === "string" && job.customerId.trim()
      ? job.customerId.trim()
      : "";
  if (legacyUid === userId) return true;

  const accessEnabled = (job as { customerAccessEnabled?: boolean }).customerAccessEnabled === true;
  const crmId =
    typeof (job as { customerId?: string }).customerId === "string"
      ? String((job as { customerId?: string }).customerId).trim()
      : "";
  const profileCrm =
    typeof profile.customerRecordId === "string" ? profile.customerRecordId.trim() : "";
  if (accessEnabled && crmId && profileCrm && crmId === profileCrm) return true;

  return false;
}

export function isFolderInternalOnly(folder: Record<string, unknown>): boolean {
  return folder.internalOnly === true;
}

/** Složka je zákazníkovi viditelná jen při explicitním customerVisible === true. */
export function isFolderCustomerVisible(folder: Record<string, unknown>): boolean {
  if (isFolderInternalOnly(folder)) return false;
  if (folder.customerVisible === true) return true;
  return false;
}

export function isFolderCustomerAnnotatable(folder: Record<string, unknown>): boolean {
  if (!isFolderCustomerVisible(folder)) return false;
  return folder.customerAnnotatable === true;
}

export function isImageCustomerVisible(
  folder: Record<string, unknown> | null | undefined,
  image: Record<string, unknown>
): boolean {
  if (image.internalOnly === true) return false;
  if ("customerVisible" in image && image.customerVisible === false) return false;
  if (image.customerVisible === true) return true;
  return folder ? isFolderCustomerVisible(folder) : false;
}

export function canCustomerAnnotateImage(
  folder: Record<string, unknown> | null | undefined,
  image: Record<string, unknown>
): boolean {
  if (!isImageCustomerVisible(folder, image)) return false;
  if (image.customerAnnotatable === true) return true;
  if (image.customerAnnotatable === false) return false;
  return folder ? isFolderCustomerAnnotatable(folder) : false;
}

/** Legacy řádek ve photos — stejná pravidla jako u obrázků ve složce (bez složky = neviditelné). */
export function isLegacyPhotoCustomerVisible(photo: Record<string, unknown>): boolean {
  if (photo.internalOnly === true) return false;
  return photo.customerVisible === true;
}

export function canCustomerAnnotateLegacyPhoto(photo: Record<string, unknown>): boolean {
  if (!isLegacyPhotoCustomerVisible(photo)) return false;
  return photo.customerAnnotatable === true;
}

/** Účetní složky dokladů pro zákazníky nezobrazujeme (finance). */
export function filterFoldersForCustomer<
  T extends Record<string, unknown> & { id: string; type?: string },
>(folders: T[]): T[] {
  return folders.filter((f) => {
    if (f.type === "documents") return false;
    return isFolderCustomerVisible(f);
  });
}
