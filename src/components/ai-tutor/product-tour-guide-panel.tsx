"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mic, MicOff, Send, Sparkles } from "lucide-react";
import type { ProductTourChatMessage } from "@/lib/product-tour/chat-service";
import type { CompanyType } from "@/lib/product-tour/company-type";
import type { ProductDemoMode } from "@/lib/ai-tutor/product-demo-script";
import { cn } from "@/lib/utils";

type Props = {
  companyType: CompanyType | null;
  tourMode: ProductDemoMode | null;
  onAssistantReply: (result: {
    answer: string;
    demoActions: import("@/lib/product-tour/demo-actions").DemoAction[];
    offerContinueTour: boolean;
  }) => void;
  onUserSpeakingStart: () => void;
  onBeforeSend: () => void;
  disabled?: boolean;
};

export function ProductTourGuidePanel({
  companyType,
  tourMode,
  onAssistantReply,
  onUserSpeakingStart,
  onBeforeSend,
  disabled,
}: Props) {
  const [messages, setMessages] = useState<ProductTourChatMessage[]>([
    {
      role: "assistant",
      content:
        "Jsem AI průvodkyně RAJMONDATA. Můžete se ptát na funkce, ceny nebo říct „ukaž mi zakázky“. Během prohlídky mě kdykoliv přerušte — poslouchám.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const sendQuestion = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      onBeforeSend();
      setBusy(true);
      const userMsg: ProductTourChatMessage = { role: "user", content: q };
      setMessages((m) => [...m, userMsg]);
      setDraft("");
      try {
        const res = await fetch("/api/public/product-tour/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            history: [...messages, userMsg].slice(-8),
            companyType,
            tourMode,
          }),
        });
        const json = await res.json();
        if (json.ok && json.answer) {
          setMessages((m) => [...m, { role: "assistant", content: json.answer }]);
          onAssistantReply({
            answer: json.answer,
            demoActions: json.demoActions ?? [],
            offerContinueTour: Boolean(json.offerContinueTour),
          });
        } else {
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              content: "Odpověď se nepodařila načíst. Zkuste to znovu nebo pište textem.",
            },
          ]);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, companyType, tourMode, onAssistantReply, onBeforeSend]
  );

  const stopMic = useCallback(() => {
    mediaRef.current?.stop();
    mediaRef.current = null;
    setListening(false);
  }, []);

  const startMic = useCallback(async () => {
    if (listening || busy) return;
    onUserSpeakingStart();
    setMicDenied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 500) return;
        setBusy(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "tour.webm");
          const res = await fetch("/api/public/product-tour/transcribe", { method: "POST", body: form });
          const json = await res.json();
          if (json.ok && json.text) await sendQuestion(json.text);
          else
            setMessages((m) => [
              ...m,
              { role: "assistant", content: "Nepodařilo se rozpoznat řeč. Napište dotaz textem." },
            ]);
        } finally {
          setBusy(false);
        }
      };
      mediaRef.current = rec;
      rec.start();
      setListening(true);
      window.setTimeout(() => stopMic(), 8000);
    } catch {
      setMicDenied(true);
      setListening(false);
    }
  }, [listening, busy, onUserSpeakingStart, sendQuestion, stopMic]);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/90 flex flex-col max-h-[420px]">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <Sparkles className="h-4 w-4 text-orange-500" />
        <span className="text-sm font-medium">AI průvodkyně</span>
        {listening ? (
          <span className="ml-auto text-xs text-orange-400 animate-pulse">Poslouchám…</span>
        ) : busy ? (
          <span className="ml-auto text-xs text-slate-400">Odpovídám…</span>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-sm min-h-[120px]">
        {messages.map((m, i) => (
          <div
            key={`${i}-${m.role}`}
            className={cn(
              "rounded-lg px-2.5 py-2 leading-relaxed",
              m.role === "user" ? "bg-orange-500/20 ml-6" : "bg-slate-800/80 mr-4 text-slate-200"
            )}
          >
            {m.content}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 px-3">
        Mikrofon slouží k dotazům. Hlas neukládáme — používáme přepis pro odpověď.{" "}
        {micDenied ? "Povolte mikrofon nebo pište textem." : ""}
      </p>
      <form
        className="flex gap-2 p-3 border-t border-slate-800"
        onSubmit={(e) => {
          e.preventDefault();
          void sendQuestion(draft);
        }}
      >
        <Button
          type="button"
          size="icon"
          variant={listening ? "destructive" : "outline"}
          className="shrink-0 border-slate-600"
          disabled={disabled || busy}
          aria-label={listening ? "Ukončit nahrávání" : "Mluvit"}
          onClick={() => (listening ? stopMic() : void startMic())}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Zeptat se AI…"
          className="bg-slate-950 border-slate-600"
          disabled={disabled || busy}
        />
        <Button type="submit" size="icon" className="bg-orange-500 hover:bg-orange-600 shrink-0" disabled={disabled || busy || !draft.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
