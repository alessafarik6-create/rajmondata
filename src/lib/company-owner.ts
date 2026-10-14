/** UID vlastníka organizace z dokumentu companies/{id}. */
export function companyOwnerUidFromRecord(
  data: Record<string, unknown> | null | undefined
): string | null {
  if (!data) return null;
  const uid = String(data.ownerId ?? data.ownerUserId ?? "").trim();
  return uid || null;
}

export function callerIsCompanyOwner(
  callerUid: string,
  companyOwnerUid: string | null | undefined
): boolean {
  const owner = String(companyOwnerUid ?? "").trim();
  const uid = String(callerUid ?? "").trim();
  return Boolean(owner && uid && owner === uid);
}
