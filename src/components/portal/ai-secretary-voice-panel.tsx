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
    case "connected":
    case "listening":
      return "● Poslouchám…";
    case "assistant_speaking":
      return "● RAJMONDATA AI mluví…";
    case "processing_tool":
      return "Provádím…";
    case "waiting_confirmation":
      return "Čekám na potvrzení…";
    case "error":
      return "Chyba připojení";
    case "ended":
      return "Ukončeno";
    default:
      return "Hlasový režim";
  }
}

export function AiSecretaryVoicePanel({ companyId, open, onClose, assistantName }: Props) {
  const { user } = useUser();
  const [lines, setLines] = useState<string[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const voice = useAiSecretaryRealtime({
    user,
    companyId,
    onError: (m) => {
      setErrorMsg(m);
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
      void stopRef.current();
      setErrorMsg(null);
      setStatusHint(null);
      setLines([]);
    }
  }, [open]);

  const handleClose = () => {
    void stopRef.current().then(onClose);
  };

  const handleStartMic = () => {
    setErrorMsg(null);
    setLines([]);
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

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-4">
      <audio ref={setAudioEl} autoPlay playsInline className="hidden" />
      <div className="w-full max-w-md rounded-2xl border bg-background shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold">{assistantName ?? "RAJMONDATA AI"}</p>
            <p className="text-xs text-muted-foreground">Hlasový režim</p>
            <p className="text-sm font-medium text-primary mt-1">
              {sessionLive ? (statusHint ?? phaseLabel(voice.phase)) : "Klikněte na mikrofon"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose} aria-label="Zavřít">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div
          className={cn(
            "flex h-28 items-center justify-center rounded-xl bg-muted/50",
            listening && "animate-pulse ring-2 ring-primary/30"
          )}
        >
          {voice.phase === "connecting" || voice.phase === "requesting_microphone" ? (
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          ) : sessionLive ? (
            <Mic className="h-12 w-12 text-primary" />
          ) : (
            <Button
              type="button"
              size="lg"
              className="h-16 w-16 rounded-full"
              onClick={handleStartMic}
              disabled={!user}
              aria-label="Spustit mikrofon"
            >
              <Mic className="h-8 w-8" />
            </Button>
          )}
        </div>

        {sessionLive && !showTranscript ? (
          <p className="text-sm text-center text-muted-foreground">
            Mluvte přirozeně — mikrofon zůstane zapnutý.
          </p>
        ) : null}

        {errorMsg ? (
          <p className="text-sm text-destructive text-center">{errorMsg}</p>
        ) : null}

        {showTranscript && lines.length > 0 ? (
          <div className="max-h-40 overflow-y-auto text-xs space-y-1 border rounded-md p-2 bg-muted/30">
            {lines.map((l, i) => (
              <p key={i} className="whitespace-pre-wrap">
                {l}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {voice.phase === "error" ? (
            <Button className="min-h-[44px] flex-1" onClick={handleStartMic}>
              Zkusit znovu
            </Button>
          ) : sessionLive ? (
            <Button variant="destructive" className="min-h-[44px] flex-1" onClick={handleClose}>
              Ukončit
            </Button>
          ) : (
            <Button className="min-h-[44px] flex-1" onClick={handleStartMic} disabled={!user}>
              <Mic className="h-4 w-4 mr-2" /> Mikrofon
            </Button>
          )}
          <Button variant="outline" className="min-h-[44px]" onClick={() => setShowTranscript((v) => !v)}>
            Textový přepis
          </Button>
        </div>
      </div>
    </div>
  );
}
