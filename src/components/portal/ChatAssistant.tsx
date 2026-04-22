"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
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
import { useCompany, useFirestore } from "@/firebase";
import { HELP_CONTENT_COLLECTION } from "@/lib/firestore-collections";
import {
  bestHelpReplyFromRows,
  HELP_CONTENT_FALLBACK,
  mergeHelpRowsForPortal,
  parseHelpContentDoc,
  pathnameToHelpModule,
  type HelpContentRow,
} from "@/lib/help-content";
import { getPortalAssistantReply, type PortalAssistantReply } from "@/lib/portal-assistant-knowledge";

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
    "Dobrý den, jsem nápověda k portálu. Zeptejte se na ovládání modulů, nebo zvolte rychlou otázku. Odpovědi vycházejí z nastavení nápovědy pro vaši organizaci — nejsou náhradou za podporu u složitých chyb.",
};

const quickChipClass =
  "inline-flex min-h-8 max-w-full items-center rounded-md border border-slate-300 bg-[#f3f4f6] px-2.5 py-1.5 text-left text-xs font-medium text-[#111827] shadow-sm transition-colors hover:bg-[#e5e7eb] hover:border-slate-400 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

export function ChatAssistant() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const firestore = useFirestore();
  const { companyId } = useCompany();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [helpRows, setHelpRows] = useState<HelpContentRow[]>([]);
  const [helpLoading, setHelpLoading] = useState(true);
  const endRef = useRef<HTMLDivElement | null>(null);

  const helpModule = pathnameToHelpModule(pathname);

  useEffect(() => {
    if (!firestore) {
      setHelpRows([]);
      setHelpLoading(false);
      return;
    }

    let cancelled = false;
    setHelpLoading(true);
    const companyIn = companyId && String(companyId).trim() ? [String(companyId).trim(), "global"] : ["global"];

    (async () => {
      try {
        const ref = collection(firestore, HELP_CONTENT_COLLECTION);
        const qy = query(
          ref,
          where("module", "==", helpModule),
          where("isActive", "==", true),
          where("companyId", "in", companyIn),
          orderBy("order", "asc"),
          limit(48)
        );
        const snap = await getDocs(qy);
        const rows: HelpContentRow[] = [];
        snap.forEach((d) => {
          const r = parseHelpContentDoc(d.id, d.data() as Record<string, unknown>);
          if (r) rows.push(r);
        });
        const merged = mergeHelpRowsForPortal(rows, companyId);
        if (!cancelled) setHelpRows(merged);
      } catch (e) {
        console.error("[ChatAssistant] helpContent", e);
        if (!cancelled) setHelpRows([]);
      } finally {
        if (!cancelled) setHelpLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, helpModule]);

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
        const fromDb = bestHelpReplyFromRows(q, helpRows);
        if (fromDb) {
          pushAssistantFromReply(fromDb);
        } else if (helpRows.length === 0) {
          pushAssistantFromReply({ text: HELP_CONTENT_FALLBACK });
        } else {
          pushAssistantFromReply(getPortalAssistantReply(q, pathname));
        }
        setTyping(false);
      }, 420);
    },
    [pathname, helpRows, pushAssistantFromReply]
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

  const quickTop = helpRows.slice(0, 6);

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
              Modul: <span className="font-medium text-slate-800">{helpModule}</span>
              {" · "}
              Stránka:{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-800">{pathname || "/"}</code>
            </SheetDescription>
          </SheetHeader>

          <div className="shrink-0 border-b border-slate-100 px-3 py-3 space-y-2 bg-slate-50/80">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-0.5">
              Rychlé otázky
            </p>
            {helpLoading ? (
              <p className="text-xs text-slate-500 px-0.5">Načítám nápovědu…</p>
            ) : quickTop.length === 0 ? (
              <p className="text-xs text-slate-700 px-0.5 leading-relaxed">{HELP_CONTENT_FALLBACK}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {quickTop.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={quickChipClass}
                    disabled={typing}
                    onClick={() => sendUserMessage(row.question)}
                  >
                    {row.question}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1 px-3 overflow-hidden">
            <div className="flex flex-col gap-4 py-4 pr-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex gap-3",
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
                      "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-slate-100 text-slate-900 border border-slate-200/90 rounded-bl-md"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.role === "assistant" && m.openHref ? (
                      <div className="mt-3 pt-2 border-t border-slate-200/80">
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
                <div className="flex gap-2 items-center text-xs text-slate-500 pl-11">
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
              className="min-h-10 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-500"
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
