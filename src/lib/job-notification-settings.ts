/**
 * Přepínače e-mailových notifikací u složek zakázky a chatů.
 */

export function isFolderNotifyEmployeesEnabled(
  folder: Record<string, unknown> | null | undefined
): boolean {
  return folder?.notifyEmployees === true;
}

export function isFolderNotifyCustomerEnabled(
  folder: Record<string, unknown> | null | undefined
): boolean {
  return folder?.notifyCustomer === true;
}

export function isJobInternalChatEmailEnabled(
  job: Record<string, unknown> | null | undefined
): boolean {
  return job?.internalChatEmailNotifications === true;
}

export function isJobCustomerChatEmailEnabled(
  job: Record<string, unknown> | null | undefined
): boolean {
  return job?.customerChatEmailNotifications === true;
}
