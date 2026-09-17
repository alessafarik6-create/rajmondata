export const NEW_ORG_NOTIFICATION_DOC_PREFIX = "new_org_";

export function newOrganizationNotificationDocId(organizationId: string): string {
  return `${NEW_ORG_NOTIFICATION_DOC_PREFIX}${organizationId}`;
}

export function adminOrganizationDetailPath(organizationId: string): string {
  return `/admin/companies?orgId=${encodeURIComponent(organizationId)}`;
}
