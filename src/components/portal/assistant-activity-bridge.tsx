"use client";

import { useEffect, useState } from "react";
import { AssistantActivityPanel } from "@/components/portal/assistant-activity-panel";
import { useAssistantActivityListener } from "@/hooks/use-assistant-activity";
import { useScreenWakeLock } from "@/hooks/use-screen-wake-lock";
import {
  VOICE_SESSION_EVENT,
  type VoiceSessionDetail,
} from "@/lib/ai/assistant/assistant-activity-types";

/** Globální UI průběhu AI + wake lock při aktivní hlasové relaci. */
export function AssistantActivityBridge() {
  const { activity } = useAssistantActivityListener(true);
  const [voiceSession, setVoiceSession] = useState<VoiceSessionDetail>({
    active: false,
    phase: "idle",
  });

  useEffect(() => {
    const onVoice = (ev: Event) => {
      const detail = (ev as CustomEvent<VoiceSessionDetail>).detail;
      if (!detail) return;
      setVoiceSession(detail);
    };
    window.addEventListener(VOICE_SESSION_EVENT, onVoice);
    return () => window.removeEventListener(VOICE_SESSION_EVENT, onVoice);
  }, []);

  const voiceActive = voiceSession.active;
  const wake = useScreenWakeLock(voiceActive);

  return (
    <>
      <AssistantActivityPanel
        activity={activity}
        voiceActive={voiceActive}
        wakeLockHeld={wake.held}
        wakeLockSupported={wake.supported}
      />
      {wake.showUnsupportedHint && voiceActive ? (
        <p
          className="fixed z-[74] left-3 right-3 mx-auto max-w-md text-center text-[11px] text-muted-foreground pointer-events-none bottom-[calc(var(--mobile-bottom-nav-height,72px)+env(safe-area-inset-bottom,0px)+4.5rem)] md:bottom-24"
          role="status"
        >
          V tomto zařízení nelze zabránit automatickému uspání displeje.
        </p>
      ) : null}
    </>
  );
}
