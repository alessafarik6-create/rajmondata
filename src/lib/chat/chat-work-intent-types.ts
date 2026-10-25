/**
 * AI rozpoznání zakázek / úkolů / schůzek z chatu (server + klient).
 */

export type ChatWorkIntentKind =
  | "new_job"
  | "task"
  | "meeting"
  | "note_to_job"
  | "unclear";

export type ChatWorkIntentDetectedType =
  | "reservation"
  | "job"
  | "task"
  | "meeting"
  | "note"
  | "unclear";

export type ChatWorkIntentDetectedItem = {
  itemId: string;
  type: ChatWorkIntentDetectedType;
  title: string | null;
  customerName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  scheduledTime: string | null;
  sourceText: string | null;
  yearNeedsConfirmation: boolean;
  confidence: number;
  assignedEmployeeHint: string | null;
};

export type ChatWorkIntentProposal = {
  proposalId: string;
  kind: ChatWorkIntentKind;
  confidence: number;
  jobTitle: string | null;
  customerName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  budgetText: string | null;
  scheduledDate: string | null;
  scheduledEndDate?: string | null;
  scheduledTime: string | null;
  dateNeedsConfirmation: boolean;
  assignedEmployeeHint: string | null;
  missingFields: string[];
  sourceQuote: string | null;
  detectedType?: ChatWorkIntentDetectedType | null;
  overlapWarning?: boolean;
  attachmentId?: string | null;
  /** Po obohacení serverem */
  customerMatch?: {
    customerId: string;
    label: string;
    matchReason: string;
  } | null;
  jobMatches?: Array<{
    jobId: string;
    name: string;
    customerName?: string | null;
    score: number;
  }>;
  completionStatus?: "complete" | "needs_input";
};

export type ChatWorkIntentAnalysisDoc = {
  id: string;
  organizationId: string;
  messageId: string;
  conversationId: string;
  attachmentIds: string[];
  messageTextSnapshot: string;
  messageCreatedAtMs: number | null;
  timeZone: string;
  readable: boolean;
  unreadableReason: string | null;
  summaryCs: string;
  documentType?: string | null;
  extractedTextPreview?: string | null;
  detectedItems?: ChatWorkIntentDetectedItem[];
  proposals: ChatWorkIntentProposal[];
  model: string;
  imageTilesSent?: number;
  imageBytesSent?: number;
  createdAt?: unknown;
  createdBy: string;
  applyIdempotencyKeys?: string[];
};

export type ChatWorkIntentApplyResult = {
  proposalId: string;
  kind: ChatWorkIntentKind;
  ok: boolean;
  error?: string;
  jobId?: string;
  jobName?: string;
  taskId?: string;
  eventId?: string;
  customerId?: string;
  commentId?: string;
};
