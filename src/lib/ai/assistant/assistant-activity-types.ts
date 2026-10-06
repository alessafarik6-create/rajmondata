export type AssistantActivityState =
  | "idle"
  | "listening"
  | "thinking"
  | "searching"
  | "navigating"
  | "opening"
  | "reading"
  | "writing"
  | "waiting_for_confirmation"
  | "done"
  | "error";

export type AssistantActivity = {
  state: AssistantActivityState;
  label: string;
  entityType?: "email" | "job" | "customer" | "document" | "calendar" | "task" | null;
  entityId?: string | null;
  targetElementId?: string | null;
  startedAt: number;
};

export const ASSISTANT_ACTIVITY_EVENT = "rajmondata-assistant-activity";

export const VOICE_SESSION_EVENT = "rajmondata-voice-session";

export type VoiceSessionDetail = {
  active: boolean;
  phase: string;
  statusHint?: string | null;
  interrupted?: boolean;
};
