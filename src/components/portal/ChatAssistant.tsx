"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MessageCircle, Send, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  getPortalAssistantReply,
  PORTAL_QUICK_QUESTIONS,
  type PortalAssistantReply,
} from "@/lib/portal-assistant-knowledge";

type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  openHref?: string;
  openLabel?: string;
};

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text:
    "Dobrý den, jsem nápověda k portálu. Zeptejte se na ovládání modulů, nebo zvolte rychlou otázku. Odpovědi jsou stručné návody — nejsou náhradou za podporu u složitých chyb.",
};

export function ChatAssistant() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, typing, open, scrollToBottom]);

  const pushAssistantFromReply = useCallback((reply: PortalAssistantReply) => {
    setMessages((prev) => [
      ...prev,
      {
        id: newId(),
        role: "assistant",
        text: reply.text,
        openHref: reply.openHref,
        openLabel: reply.openLabel,
      },
    ]);
  }, []);

  const runReply = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q) return;
      setTyping(true);
      window.setTimeout(() => {
        const reply = getPortalAssistantReply(q, pathname);
        pushAssistantFromReply(reply);
        setTyping(false);
      }, 650);
    },
    [pathname, pushAssistantFromReply]
  );

  const sendUserMessage = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || typing) return;
      setMessages((prev) => [...prev, { id: newId(), role: "user", text: t }]);
      setDraft("");
      runReply(t);
    },
    [typing, runReply]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendUserMessage(draft);
  };

  return (
    <>
      {!open ? (
        <button
          type="button"
          aria-label="Otevřít nápovědu k portálu"
          onClick={() => setOpen(true)}
          className={cn(
            "fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg",
            "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "transition-transform hover:scale-105 active:scale-95 print:hidden"
          )}
        >
          <MessageCircle className="h-7 w-7" aria-hidden />
        </button>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className={cn(
            "flex w-full flex-col gap-0 border-slate-200 bg-white p-0 sm:max-w-md",
            "text-slate-900 h-[100dvh] max-h-[100dvh] overflow-hidden"
          )}
        >
          <SheetHeader className="shrink-0 border-b border-slate-100 px-4 py-4 text-left space-y-1">
            <SheetTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Sparkles className="h-5 w-5 text-primary shrink-0" />
              Nápověda k portálu
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-600 leading-snug">
              Rychlé odpovědi podle modulu. Aktuální stránka:{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{pathname || "/"}</code>
            </SheetDescription>
          </SheetHeader>

          <div className="shrink-0 border-b border-slate-100 px-3 py-3 space-y-2 bg-slate-50/80">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-0.5">
              Rychlé otázky
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PORTAL_QUICK_QUESTIONS.map((q) => (
                <Button
                  key={q.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-8 whitespace-normal text-left text-xs py-1.5 px-2 border-slate-200 bg-white hover:bg-slate-50"
                  disabled={typing}
                  onClick={() => sendUserMessage(q.label)}
                >
                  {q.label}
                </Button>
              ))}
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1 px-3 overflow-hidden">
            <div className="flex flex-col gap-3 py-3 pr-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex gap-2",
                    m.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[10px]",
                      m.role === "user"
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-slate-200 bg-white text-slate-600"
                    )}
                  >
                    {m.role === "user" ? (
                      <User className="h-4 w-4" aria-hidden />
                    ) : (
                      <Sparkles className="h-4 w-4" aria-hidden />
                    )}
                  </div>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-slate-100 text-slate-900 border border-slate-100 rounded-bl-md"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.role === "assistant" && m.openHref ? (
                      <div className="mt-2 pt-2 border-t border-slate-200/80">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="w-full text-xs h-8"
                          onClick={() => {
                            setOpen(false);
                            router.push(m.openHref!);
                          }}
                        >
                          {m.openLabel || "Otevřít tuto sekci"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {typing ? (
                <div className="flex gap-2 items-center text-xs text-slate-500 pl-10">
                  <span className="inline-flex gap-1">
                    <span className="animate-pulse">Píšu</span>
                    <span className="inline-flex gap-0.5">
                      <span className="inline-block w-1 h-1 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.2s]" />
                      <span className="inline-block w-1 h-1 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.1s]" />
                      <span className="inline-block w-1 h-1 rounded-full bg-slate-400 animate-bounce" />
                    </span>
                  </span>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
          </ScrollArea>

          <form
            onSubmit={onSubmit}
            className="shrink-0 border-t border-slate-100 p-3 bg-white flex gap-2 items-end"
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Napište otázku…"
              className="min-h-10 bg-slate-50 border-slate-200"
              disabled={typing}
              aria-label="Text otázky"
            />
            <Button
              type="submit"
              size="icon"
              className="h-10 w-10 shrink-0"
              disabled={typing || !draft.trim()}
              aria-label="Odeslat"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
