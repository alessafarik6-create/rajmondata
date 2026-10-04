"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, X } from "lucide-react";
import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { useAiSecretaryRealtime, type VoiceSecretaryPhase } from "@/hooks/use-ai-secretary-realtime";
import { cn } from "@/lib/utils";

type Props = {
  companyId: string;
  open: boolean;
  onClose: () => void;
  assistantName?: string;
};

function phaseLabel(phase: VoiceSecretaryPhase): string {
  switch (phase) {
    case "requesting_microphone":
      return "Žádám o mikrofon…";
    case "connecting":
      return "Připojuji…";
    case "processing_tool":
      return "Provádím…";
    case "connected":
    case "listening":
      return "● Poslouchám…";
    case "assistant_speaking":
      return "Sekretářka mluví…";
    case "waiting_confirmation":
      return "Čekám na potvrzení…";
    case "error":
      return "Chyba připojení";
    case "ended":
      return "Ukončeno";
    default:
      return "Hlasová sekretářka";
  }
}

export function AiSecretaryVoicePanel({ companyId, open, onClose, assistantName }: Props) {
  const { user } = useUser();
  const [lines, setLines] = useState<string[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const autoStartedRef = useRef(false);

  const voice = useAiSecretaryRealtime({
    user,
    companyId,
    onError: (m, detail) => {
      setErrorMsg(m);
      setErrorCode(detail?.code ?? null);
      setLines((l) => [...l, `⚠ ${m}`]);
    },
    onStatusHint: setStatusHint,
    onTranscript: (line) => {
      if (line.role === "user") {
        setLines((l) => [...l, line.text]);
      } else {
        setLines((l) => [...l, `RAJMONDATA AI: ${line.text}`]);
      }
    },
  });

  const startRef = useRef(voice.start);
  const stopRef = useRef(voice.stop);
  const attachRef = useRef(voice.attachAudioElement);
  startRef.current = voice.start;
  stopRef.current = voice.stop;
  attachRef.current = voice.attachAudioElement;

  const setAudioEl = useCallback((el: HTMLAudioElement | null) => {
    attachRef.current(el);
  }, []);

  useEffect(() => {
    if (!open) {
      autoStartedRef.current = false;
      void stopRef.current();
      setErrorMsg(null);
      setErrorCode(null);
      setStatusHint(null);
      setLines([]);
      return;
    }
    if (autoStartedRef.current || !user) return;
    autoStartedRef.current = true;
    setErrorMsg(null);
    setErrorCode(null);
    setLines([]);
    void startRef.current();
  }, [open, user]);

  const handleClose = () => {
    void stopRef.current().then(onClose);
  };

  const handleRetry = () => {
    setErrorMsg(null);
    setErrorCode(null);
    setLines([]);
    autoStartedRef.current = true;
    void startRef.current();
  };

  if (!open) return null;

  const sessionLive =
    voice.phase !== "idle" &&
    voice.phase !== "error" &&
    voice.phase !== "ended";

  const listening =
    voice.phase === "listening" ||
    voice.phase === "connected" ||
    voice.phase === "assistant_speaking";

  const statusText = sessionLive
    ? statusHint ?? phaseLabel(voice.phase)
    : voice.phase === "connecting" || voice.phase === "requesting_microphone"
      ? phaseLabel(voice.phase)
      : "Připojuji…";

  return (
    <div
      className={cn(
        "fixed inset-0 z-[80] flex justify-center",
        "max-md:items-end max-md:p-0",
        "md:items-center md:p-4",
        "bg-black/20 md:bg-black/40"
      )}
    >
      <audio ref={setAudioEl} autoPlay playsInline className="hidden" aria-hidden />
      <div
        className={cn(
          "w-full border bg-background shadow-xl flex flex-col overflow-hidden",
          "max-md:max-h-[92dvh] max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0",
          "md:max-w-md md:rounded-2xl",
          "pb-[max(1rem,env(safe-area-inset-bottom))]"
        )}
      >
        <div className="p-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 truncate">
                {assistantName ?? "RAJMONDATA AI"}
              </p>
              <p className="text-xs text-muted-foreground">Hlasová sekretářka</p>
              <p className="text-sm font-medium text-orange-600 mt-1">{statusText}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleClose} aria-label="Zavřít">
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div
            className={cn(
              "flex h-28 flex-col items-center justify-center gap-2 rounded-xl bg-orange-50/80 border border-orange-100",
              listening && "ring-2 ring-orange-300/50"
            )}
          >
            {voice.phase === "connecting" ||
            voice.phase === "requesting_microphone" ||
            (!sessionLive && voice.phase !== "error") ? (
              <Loader2 className="h-10 w-10 animate-spin text-orange-600" />
            ) : (
              <>
                <Mic
                  className={cn(
                    "h-10 w-10 text-orange-600",
                    voice.phase === "assistant_speaking" && "animate-pulse"
                  )}
                />
                {listening && (
                  <div className="flex h-6 items-end gap-1" aria-hidden>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className="w-1 rounded-full bg-orange-500/70 animate-pulse"
                        style={{
                          height: `${10 + (i % 3) * 8}px`,
                          animationDelay: `${i * 0.15}s`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {sessionLive ? (
            <p className="text-sm text-center text-muted-foreground">
              Mluvte přirozeně — mikrofon zůstane zapnutý.
            </p>
          ) : null}

          {errorMsg ? (
            <div className="text-center space-y-1">
              <p className="text-sm text-destructive">{errorMsg}</p>
              {errorCode && process.env.NODE_ENV === "development" ? (
                <p className="text-xs text-muted-foreground font-mono">{errorCode}</p>
              ) : null}
            </div>
          ) : null}

          {showTranscript && lines.length > 0 ? (
            <div className="max-h-40 overflow-y-auto text-xs space-y-1 border rounded-md p-2 bg-muted/30">
              {lines.map((l, i) => (
                <p key={i} className="whitespace-pre-wrap break-words">
                  {l}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="px-5 pb-5 flex flex-wrap gap-2 border-t border-border/60 pt-4 bg-background">
          {voice.phase === "error" ? (
            <Button className="min-h-[48px] flex-1 bg-orange-600 hover:bg-orange-700" onClick={handleRetry}>
              Zkusit znovu
            </Button>
          ) : sessionLive ? (
            <Button variant="destructive" className="min-h-[48px] flex-1" onClick={handleClose}>
              Ukončit
            </Button>
          ) : (
            <Button
              className="min-h-[48px] flex-1 bg-orange-600 hover:bg-orange-700"
              disabled
              aria-busy
            >
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Připojuji…
            </Button>
          )}
          <Button
            variant="outline"
            className="min-h-[48px] shrink-0"
            onClick={() => setShowTranscript((v) => !v)}
          >
            Textový přepis
          </Button>
        </div>
      </div>
    </div>
  );
}
