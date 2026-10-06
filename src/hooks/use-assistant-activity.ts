"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssistantActivity } from "@/lib/ai/assistant/assistant-activity-types";
import { ASSISTANT_ACTIVITY_EVENT } from "@/lib/ai/assistant/assistant-activity-types";
import {
  applyAssistantHighlight,
  clearAssistantHighlight,
  idleAssistantActivity,
} from "@/lib/ai/assistant/assistant-activity-client";

export function useAssistantActivityListener(enabled = true) {
  const [activity, setActivity] = useState<AssistantActivity>(() => idleAssistantActivity());

  useEffect(() => {
    if (!enabled) return;
    const onAct = (ev: Event) => {
      const detail = (ev as CustomEvent<AssistantActivity>).detail;
      if (!detail?.state) return;
      setActivity(detail);
      if (detail.targetElementId) {
        requestAnimationFrame(() => applyAssistantHighlight(detail.targetElementId));
      } else if (detail.state === "idle" || detail.state === "done") {
        clearAssistantHighlight();
      }
    };
    window.addEventListener(ASSISTANT_ACTIVITY_EVENT, onAct);
    return () => {
      window.removeEventListener(ASSISTANT_ACTIVITY_EVENT, onAct);
      clearAssistantHighlight();
    };
  }, [enabled]);

  const reset = useCallback(() => {
    setActivity(idleAssistantActivity());
    clearAssistantHighlight();
  }, []);

  return { activity, reset };
}
