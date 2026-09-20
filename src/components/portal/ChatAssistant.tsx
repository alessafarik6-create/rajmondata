"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { Loader2, MessageCircle, Mic, Send, Sparkles, Square, User } from "lucide-react";
import { useIsBelowLg } from "@/hooks/use-mobile";
import { useDraggableFabPosition } from "@/hooks/use-draggable-fab-position";
import { usePortalAssistantVoice } from "@/hooks/use-portal-assistant-voice";
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
import { useCompany, useFirestore, useUser } from "@/firebase";
import { HELP_CONTENT_COLLECTION } from "@/lib/firestore-collections";
import {
  bestHelpReplyFromRows,
  chunkFirestoreIn,
  firestoreModuleVariantsForCanonical,
  HELP_CONTENT_FALLBACK,
  mergeHelpRowsByFallbackTiers,
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
    "Dobrý den, jsem AI nápověda k portálu RajmonData. Zeptejte se, kde něco najdete nebo jak postupovat — beru v úvahu vaši roli, oprávnění a aktuální stránku.",
};

const EXAMPLE_QUESTIONS = [
  "Jak vytvořit nabídku?",
  "Kde najdu zálohy?",
  "Jak přidat zaměstnance?",
  "Jak změnit stav zakázky?",
];

const quickChipClass =
  "inline-flex min-h-8 max-w-full items-center rounded-md border border-slate-300 bg-[#f3f4f6] px-2.5 py-1.5 text-left text-xs font-medium text-[#111827] shadow-sm transition-colors hover:bg-[#e5e7eb] hover:border-slate-400 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

const FAB_BOTTOM_DESKTOP = "bottom-[calc(16px+env(safe-area-inset-bottom,0px))]";

export function ChatAssistant() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const firestore = useFirestore();
  const { companyId } = useCompany();
  const { user } = useUser();
  const isMobileLayout = useIsBelowLg();
  const onChatRoute = pathname.startsWith("/portal/chat") || pathname.includes("/messages");
  const fabDrag = useDraggableFabPosition({
    enabled: isMobileLayout,
    avoidBottomInset: onChatRoute ? 72 : 0,
  });

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

    const helpDebug = (msg: string, data: Record<string, unknown>) => {
      if (process.env.NODE_ENV !== "development") return;
      console.debug(`[ChatAssistant/help] ${msg}`, data);
    };

    (async () => {
      const ref = collection(firestore, HELP_CONTENT_COLLECTION);
      const variantSet = new Set<string>([
        ...firestoreModuleVariantsForCanonical(helpModule),
        ...(helpModule !== "dashboard" ? firestoreModuleVariantsForCanonical("dashboard") : []),
      ]);
      const chunks = chunkFirestoreIn([...variantSet], 10);
      const rows: HelpContentRow[] = [];

      try {
        for (const modChunk of chunks) {
          if (modChunk.length === 0) continue;
          const qy = query(ref, where("isActive", "==", true), where("module", "in", modChunk), limit(200));
          const snap = await getDocs(qy);
          snap.forEach((d) => {
            const r = parseHelpContentDoc(d.id, d.data() as Record<string, unknown>);
            if (r) rows.push(r);
          });
        }

        const byId = new Map<string, HelpContentRow>();
        for (const r of rows) {
          if (!byId.has(r.id)) byId.set(r.id, r);
        }
        const deduped = [...byId.values()];
        const merged = mergeHelpRowsByFallbackTiers(deduped, helpModule, companyId);

        helpDebug("helpContent loaded", {
          companyId: companyId ?? null,
          pathname,
          helpModule,
          moduleVariants: [...variantSet],
          queryChunks: chunks.length,
          rawDocs: rows.length,
          mergedCount: merged.length,
        });

        if (!cancelled) setHelpRows(merged);
      } catch (e) {
        const err = e as { message?: string; code?: string };
        console.warn("[ChatAssistant/helpContent] Firestore dotaz selhal", {
          message: err?.message,
          code: err?.code,
          companyId: companyId ?? null,
          helpModule,
          hint:
            "Potřebný index (kolekce helpContent): isActive ASC, module ASC — viz firestore.indexes.json; po deployi vytvoř index ve Firebase Console.",
        });
        helpDebug("query error detail", { error: String(e) });
        if (!cancelled) setHelpRows([]);
      } finally {
        if (!cancelled) setHelpLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, helpModule, pathname]);

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

      void (async () => {
        try {
          if (user) {
            const token = await user.getIdToken();
            const res = await fetch("/api/company/portal-assistant/ask", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ question: q, pathname }),
            });
            const data = (await res.json()) as {
              ok?: boolean;
              reply?: PortalAssistantReply;
              error?: string;
            };
            if (res.ok && data.ok && data.reply?.text) {
              pushAssistantFromReply(data.reply);
              return;
            }
          }
        } catch {
          /* fallback */
        }

        const fromDb = bestHelpReplyFromRows(q, helpRows);
        if (fromDb) {
          pushAssistantFromReply(fromDb);
        } else if (helpRows.length === 0) {
          pushAssistantFromReply({ text: HELP_CONTENT_FALLBACK });
        } else {
          pushAssistantFromReply(getPortalAssistantReply(q, pathname));
        }
      })().finally(() => setTyping(false));
    },
    [pathname, helpRows, pushAssistantFromReply, user]
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

  const { voiceState, voiceStatusHint, toggleMic } = usePortalAssistantVoice({
    user,
    onTranscript: (text) => setDraft((prev) => (prev ? `${prev.trimEnd()} ${text}` : text)),
    onError: (msg) => {
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", text: msg },
      ]);
    },
  });

  const quickTop = helpRows.slice(0, 6);

  return (
    <>
      {!open ? (
        <button
          type="button"
          aria-label="Otevřít nápovědu k portálu"
          onPointerDown={isMobileLayout ? fabDrag.onPointerDown : undefined}
          onPointerMove={isMobileLayout ? fabDrag.onPointerMove : undefined}
          onPointerUp={isMobileLayout ? fabDrag.onPointerUp : undefined}
          onClick={() => {
            if (isMobileLayout && fabDrag.wasDragged()) {
              fabDrag.resetDragFlag();
              return;
            }
            setOpen(true);
          }}
          style={
            isMobileLayout
              ? {
                  left: fabDrag.pos.left,
                  top: fabDrag.pos.top,
                  touchAction: "none",
                }
              : undefined
          }
          className={cn(
            "fixed z-[80] flex h-14 w-14 min-h-[56px] min-w-[56px] items-center justify-center rounded-full shadow-lg",
            !isMobileLayout && `right-4 ${FAB_BOTTOM_DESKTOP}`,
            "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "transition-transform hover:scale-105 active:scale-95 print:hidden"
          )}
        >
          <MessageCircle className="h-7 w-7" aria-hidden />
        </button>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobileLayout ? "bottom" : "right"}
          className={cn(
            "flex w-full flex-col gap-0 border-slate-200 bg-white p-0 text-slate-900 overflow-hidden",
            isMobileLayout
              ? "h-[88dvh] max-h-[88dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom,0px)]"
              : "sm:max-w-md h-[100dvh] max-h-[100dvh]"
          )}
        >
          <SheetHeader className="shrink-0 border-b border-slate-100 px-4 py-4 text-left space-y-1">
            <SheetTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Sparkles className="h-5 w-5 text-primary shrink-0" />
              AI nápověda
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
                {quickTop.length === 0
                  ? EXAMPLE_QUESTIONS.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        className={quickChipClass}
                        disabled={typing}
                        onClick={() => sendUserMessage(ex)}
                      >
                        {ex}
                      </button>
                    ))
                  : null}
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
                    <span className="animate-pulse">AI hledá odpověď v portálu…</span>
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
            className="shrink-0 border-t border-slate-100 p-3 bg-white flex flex-col gap-2"
          >
            {voiceStatusHint ? (
              <p className="text-xs text-slate-600 px-0.5" role="status">
                {voiceStatusHint}
              </p>
            ) : null}
            <div className="flex gap-2 items-end">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Zeptejte se, kde něco najdete nebo jak se něco dělá…"
                className="min-h-11 flex-1 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-500"
                disabled={typing || voiceState === "processing"}
                aria-label="Text otázky"
              />
              <Button
                type="button"
                size="icon"
                variant={voiceState === "recording" ? "destructive" : "outline"}
                className="h-11 w-11 shrink-0"
                disabled={typing || voiceState === "processing"}
                aria-label={
                  voiceState === "recording"
                    ? "Zastavit nahrávání"
                    : voiceState === "processing"
                      ? "Přepisuji řeč"
                      : "Mluvit do mikrofonu"
                }
                onClick={toggleMic}
              >
                {voiceState === "processing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : voiceState === "recording" ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
              <Button
                type="submit"
                size="icon"
                className="h-11 w-11 shrink-0"
                disabled={typing || !draft.trim() || voiceState === "processing"}
                aria-label="Odeslat"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
