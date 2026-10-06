"use client";

import type { AssistantActivity } from "@/lib/ai/assistant/assistant-activity-types";
import { ASSISTANT_ACTIVITY_EVENT } from "@/lib/ai/assistant/assistant-activity-types";

const HIGHLIGHT_CLASS = "rajmon-assistant-highlight";

export function dispatchAssistantActivity(
  input: Omit<AssistantActivity, "startedAt"> & { startedAt?: number }
): void {
  if (typeof window === "undefined") return;
  const detail: AssistantActivity = {
    ...input,
    startedAt: input.startedAt ?? Date.now(),
  };
  window.dispatchEvent(new CustomEvent(ASSISTANT_ACTIVITY_EVENT, { detail }));
}

export function clearAssistantHighlight(): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS);
  });
}

export function applyAssistantHighlight(targetElementId: string | null | undefined): void {
  if (typeof document === "undefined") return;
  clearAssistantHighlight();
  if (!targetElementId) return;
  const el = document.getElementById(targetElementId);
  if (!el) return;
  el.classList.add(HIGHLIGHT_CLASS);
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function assistantTargetId(
  entityType: AssistantActivity["entityType"],
  entityId: string
): string {
  return `assistant-target-${entityType ?? "item"}-${entityId}`;
}

export function activityFromVoicePhase(phase: string, statusHint?: string | null): AssistantActivity | null {
  if (phase === "idle" || phase === "ended") return null;
  const hint = statusHint?.trim();
  if (phase === "listening" || phase === "connected") {
    return { state: "listening", label: hint || "Naslouchám…", startedAt: Date.now() };
  }
  if (phase === "assistant_speaking") {
    return { state: "thinking", label: hint || "Sekretářka mluví…", startedAt: Date.now() };
  }
  if (phase === "processing_tool") {
    return { state: "thinking", label: hint || "Přemýšlím…", startedAt: Date.now() };
  }
  if (phase === "waiting_confirmation") {
    return {
      state: "waiting_for_confirmation",
      label: hint || "Čekám na potvrzení…",
      startedAt: Date.now(),
    };
  }
  if (phase === "reconnecting") {
    return { state: "thinking", label: "Obnovuji spojení…", startedAt: Date.now() };
  }
  if (phase === "connecting" || phase === "requesting_microphone") {
    return { state: "thinking", label: hint || "Připojuji…", startedAt: Date.now() };
  }
  if (phase === "error") {
    return { state: "error", label: hint || "Chyba spojení", startedAt: Date.now() };
  }
  return null;
}

export function activityFromToolResult(
  toolName: string,
  result: Record<string, unknown>
): Omit<AssistantActivity, "startedAt"> | null {
  const name = toolName.toLowerCase();
  if (name.includes("search_jobs") || name === "searchjobs") {
    return { state: "searching", label: "Hledám zakázku…", entityType: "job" };
  }
  if (name.includes("search_customers")) {
    return { state: "searching", label: "Hledám zákazníka…", entityType: "customer" };
  }
  if (name.includes("search_emails") || name.includes("get_recent_emails")) {
    return { state: "searching", label: "Hledám e-mail…", entityType: "email" };
  }
  if (name === "show_email" || (result.showEmail && result.emailId)) {
    const id = String(result.emailId ?? "");
    const subj = String(result.subject ?? "").trim();
    return {
      state: "opening",
      label: subj ? `Otevírám: ${subj.slice(0, 60)}` : "Otevírám e-mail…",
      entityType: "email",
      entityId: id || null,
      targetElementId: id ? assistantTargetId("email", id) : null,
    };
  }
  if (name === "show_email_attachment" || result.showEmailAttachment) {
    const fn = String(result.filename ?? "").trim();
    return {
      state: "reading",
      label: fn ? `Kontroluji přílohu: ${fn.slice(0, 50)}` : "Kontroluji přílohu…",
      entityType: "email",
      entityId: result.emailId != null ? String(result.emailId) : null,
    };
  }
  if (name === "open_job" && result.jobId) {
    const id = String(result.jobId);
    return {
      state: "opening",
      label: "Otevírám zakázku…",
      entityType: "job",
      entityId: id,
      targetElementId: assistantTargetId("job", id),
    };
  }
  if (name === "get_email_detail") {
    const email = result.email as Record<string, unknown> | undefined;
    const id = String(result.emailId ?? email?.id ?? "");
    const subj = String(email?.subject ?? result.subject ?? "").trim();
    const from = String(email?.from ?? result.from ?? "").trim();
    const fromLabel = from.replace(/.*<([^>]+)>.*/, "$1").trim() || from;
    return {
      state: "reading",
      label: subj
        ? `Čtu: ${subj.slice(0, 80)}`
        : fromLabel
          ? `Čtu e-mail od ${fromLabel.slice(0, 40)}`
          : "Čtu e-mail…",
      entityType: "email",
      entityId: id || null,
      targetElementId: id ? assistantTargetId("email", id) : null,
    };
  }
  if (name.includes("calendar") || name.includes("meeting")) {
    return { state: "reading", label: "Kalendář…", entityType: "calendar" };
  }
  if (name.includes("task")) {
    return { state: "searching", label: "Úkoly…", entityType: "task" };
  }
  if (name.includes("email") && name.includes("draft")) {
    return { state: "writing", label: "Připravuji e-mail…", entityType: "email" };
  }
  return null;
}

export function idleAssistantActivity(): AssistantActivity {
  return { state: "idle", label: "", startedAt: Date.now() };
}
