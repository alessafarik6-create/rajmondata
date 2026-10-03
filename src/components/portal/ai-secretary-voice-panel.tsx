"use client";

import { useState } from "react";
import { Loader2, Mic, MicOff, X } from "lucide-react";
import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { useAiSecretaryRealtime } from "@/hooks/use-ai-secretary-realtime";
import { cn } from "@/lib/utils";

type Props = {
  companyId: string;
  open: boolean;
  onClose: () => void;
  assistantName?: string;
};

export function AiSecretaryVoicePanel({ companyId, open, onClose, assistantName }: Props) {
  const { user } = useUser();
  const [lines, setLines] = useState<string[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);

  const voice = useAiSecretaryRealtime({
    user,
    companyId,
    onError: (m) => setLines((l) => [...l, `⚠ ${m}`]),
    onTranscriptLine: (t) => setLines((l) => [...l.slice(-20), t]),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-background shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">{assistantName ?? "RAJMONDATA AI"}</p>
            <p className="text-xs text-muted-foreground">
              {voice.phase === "listening"
                ? "● Poslouchám…"
                : voice.phase === "connecting"
                  ? "Připojuji…"
                  : "Hlasový režim"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void voice.stop().then(onClose)}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div
          className={cn(
            "flex h-24 items-center justify-center rounded-xl bg-muted/50",
            voice.phase === "listening" && "animate-pulse"
          )}
        >
          {voice.phase === "connecting" ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          ) : (
            <Mic className="h-10 w-10 text-primary" />
          )}
        </div>

        {showTranscript && lines.length > 0 ? (
          <div className="max-h-32 overflow-y-auto text-xs text-muted-foreground space-y-1 border rounded-md p-2">
            {lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {voice.phase === "idle" || voice.phase === "error" ? (
            <Button className="min-h-[44px] flex-1" onClick={() => void voice.start()}>
              <Mic className="h-4 w-4 mr-2" /> Mikrofon
            </Button>
          ) : (
            <Button variant="destructive" className="min-h-[44px] flex-1" onClick={() => void voice.stop()}>
              <MicOff className="h-4 w-4 mr-2" /> Ukončit
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
