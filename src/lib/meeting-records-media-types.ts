/** Audio, přepis a AI zápis u meetingRecords — metadata ve Firestore, soubor ve Storage. */

export type MeetingAudioStatus = "recording" | "processing" | "ready" | "failed";

export type MeetingTranscriptStatus = "idle" | "processing" | "ready" | "failed";

export type MeetingAiSummaryStatus = "idle" | "processing" | "ready" | "failed";

export type MeetingAudioMeta = {
  status: MeetingAudioStatus;
  storagePath?: string | null;
  mimeType?: string | null;
  durationSeconds?: number;
  recordedByUserId?: string | null;
  recordedByName?: string | null;
  uploadSessionId?: string | null;
  chunkCount?: number;
  chunkPaths?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
  errorMessage?: string | null;
};

export type MeetingTranscriptSegment = {
  speakerLabel?: string | null;
  text: string;
};

export type MeetingTranscriptMeta = {
  status: MeetingTranscriptStatus;
  text?: string | null;
  segments?: MeetingTranscriptSegment[];
  language?: string;
  createdAt?: unknown;
  errorMessage?: string | null;
};

export type MeetingAiSummarySection = {
  key: string;
  title: string;
  body: string;
  items?: string[];
};

export type MeetingAiSuggestedTask = {
  title: string;
  description?: string;
  dueDate?: string | null;
  assignedTo?: string | null;
  sourceQuote?: string | null;
  confidence: "high" | "medium" | "low";
  selected?: boolean;
};

export type MeetingAiSuggestedActions = {
  tasks: MeetingAiSuggestedTask[];
  appointments: MeetingAiSuggestedTask[];
  customerUpdates: MeetingAiSuggestedTask[];
  jobUpdates: MeetingAiSuggestedTask[];
};

export type MeetingAiSummaryMeta = {
  status: MeetingAiSummaryStatus;
  structured?: MeetingAiSummaryStructured | null;
  markdown?: string | null;
  suggestedActions?: MeetingAiSuggestedActions | null;
  createdAt?: unknown;
  errorMessage?: string | null;
};

export type MeetingAiSummaryStructured = {
  shortSummary: string;
  mainPoints: string[];
  agreed: string[];
  tasks: string[];
  deadlines: string[];
  amounts: string[];
  customerRequirements: string[];
  openQuestions: string[];
  doNotForget: string[];
  nextSteps: string[];
  uncertainNotes?: string[];
};

export type MeetingRecordCalendarLink = {
  calendarEventId?: string | null;
  calendarEventKind?: "meeting" | "installation" | "measurement" | null;
};
