/** Draft pro vytvoření jedné zakázky z AI hromadné kontroly. */

export type ChatWorkIntentJobApplyDraft = {
  jobTitle: string;
  scheduledDate?: string | null;
  scheduledEndDate?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  /** true = vytvořit nového zákazníka z polí výše */
  createNewCustomer?: boolean;
  note?: string | null;
  /** companies/{id}/employees/{employeeId} */
  assignedEmployeeIds?: string[];
  notifyEmployee?: boolean;
};

export type ChatWorkIntentApplyDraftsByProposal = Record<string, ChatWorkIntentJobApplyDraft>;
