"use client";

import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useSearchModalInsets } from "@/hooks/use-search-modal-insets";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { useCompany, useUser } from "@/firebase";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchResultsList } from "@/components/search/search-results-list";
import { KnowledgeSearchAnswerCard } from "@/components/search/knowledge-search-answer-card";
import { SearchInlineFilePreview } from "@/components/search/search-inline-file-preview";
import {
  fetchCompanySearch,
  loadRecentSearches,
  pushRecentSearch,
} from "@/lib/search/client";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 320;

/** Pevná šířka spouštěče v headeru — nesmí se měnit podle modalu. */
export const GLOBAL_SEARCH_TRIGGER_WIDTH_CLASS =
  "w-[clamp(360px,32vw,520px)] max-w-[520px] shrink-0";

type GlobalSearchProps = {
  className?: string;
  dashboardDark?: boolean;
};

function isPreviewableFile(item: SearchResultItem): boolean {
  const title = item.metadata.fileName ?? item.title;
  const mime = item.mimeType ?? "";
  return (
    !!item.fileUrl &&
    (item.entityType === "file" ||
      item.entityType === "document" ||
      mime.includes("pdf") ||
      mime.startsWith("image/") ||
      /\.(pdf|jpe?g|png|webp|gif)$/i.test(title))
  );
}

export function GlobalSearchBar({ className, dashboardDark }: GlobalSearchProps) {
  const router = useRouter();
  const { user } = useUser();
  const { companyId } = useCompany();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [previewItem, setPreviewItem] = useState<SearchResultItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { topPx, maxHeightCss } = useSearchModalInsets(open);

  useEffect(() => {
    if (open) {
      setRecent(loadRecentSearches());
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setPreviewItem(null);
    }
  }, [open]);

  const runSearch = useCallback(
    async (q: string, opts?: { knowledgeAnswer?: boolean }) => {
      if (!user || !companyId || !q.trim()) {
        setResponse(null);
        return;
      }
      const withKnowledge = opts?.knowledgeAnswer === true;
      if (withKnowledge) setKnowledgeLoading(true);
      else setLoading(true);
      setError(null);
      setPreviewItem(null);
      try {
        const token = await user.getIdToken();
        const data = await fetchCompanySearch({
          token,
          companyId,
          query: q.trim(),
          limit: 20,
          knowledgeAnswer: withKnowledge,
        });
        setResponse(data);
        setActiveIndex(data.results.length ? 0 : -1);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chyba vyhledávání");
        if (!withKnowledge) setResponse(null);
      } finally {
        if (withKnowledge) setKnowledgeLoading(false);
        else setLoading(false);
      }
    },
    [user, companyId]
  );

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResponse(null);
      setLoading(false);
      setKnowledgeLoading(false);
      setPreviewItem(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(query, { knowledgeAnswer: false });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runSearch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openResult = (item: SearchResultItem) => {
    if (query.trim()) pushRecentSearch(query.trim());
    setOpen(false);
    router.push(item.openUrl);
  };

  const openPreview = (item: SearchResultItem) => {
    setPreviewItem(item);
  };

  const askKnowledge = () => {
    if (!query.trim()) return;
    pushRecentSearch(query.trim());
    void runSearch(query, { knowledgeAnswer: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const results = response?.results ?? [];
    if (e.key === "Escape") {
      if (previewItem) {
        setPreviewItem(null);
        return;
      }
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) setActiveIndex((i) => Math.min(results.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      if (activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault();
        const item = results[activeIndex];
        if ((e.ctrlKey || e.metaKey) && item.fileUrl) {
          window.open(item.fileUrl, "_blank", "noopener,noreferrer");
          return;
        }
        if (isPreviewableFile(item)) {
          openPreview(item);
          return;
        }
        openResult(item);
        return;
      }
      if (query.trim()) {
        e.preventDefault();
        if (response?.isKnowledgeQuestion) {
          askKnowledge();
          return;
        }
        pushRecentSearch(query.trim());
        setOpen(false);
        router.push(`/portal/search?q=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  const showKnowledgeHint =
    !!query.trim() &&
    response?.isKnowledgeQuestion &&
    !response.knowledgeAnswer &&
    !knowledgeLoading;

  const emptyMessage =
    response?.isKnowledgeQuestion && !response.results.length
      ? "V CRM nic nenalezeno. Stiskněte Enter nebo „Zeptat se AI“ pro dotaz do znalostní báze."
      : "Žádné výsledky";

  return (
    <>
      <button
        type="button"
        className={cn(
          "relative hidden items-center sm:flex",
          GLOBAL_SEARCH_TRIGGER_WIDTH_CLASS,
          className
        )}
        onClick={() => setOpen(true)}
        aria-label="Globální vyhledávání"
      >
        <Search
          className={cn(
            "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 pointer-events-none",
            dashboardDark ? "text-slate-300" : "text-gray-600"
          )}
        />
        <Input
          readOnly
          tabIndex={-1}
          placeholder="Hledejte zákazníka, doklad, fakturu, PDF, zakázku…"
          className={cn(
            "h-10 w-full cursor-pointer pl-10",
            dashboardDark && "bg-white/10 border-white/20 text-white placeholder:text-slate-300"
          )}
        />
      </button>

      <button
        type="button"
        className="sm:hidden inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border"
        onClick={() => setOpen(true)}
        aria-label="Hledat"
      >
        <Search className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          style={
            {
              "--search-modal-top": `${topPx}px`,
              "--search-modal-max-h": maxHeightCss,
            } as CSSProperties
          }
          className={cn(
            "fixed left-1/2 z-50 flex w-[calc(100vw-16px)] max-w-[calc(100vw-16px)] flex-col gap-0 overflow-hidden p-0",
            "!top-[var(--search-modal-top)] !max-h-[var(--search-modal-max-h)] !-translate-x-1/2 !translate-y-0",
            "sm:w-[min(820px,calc(100vw-48px))] sm:max-w-[min(820px,calc(100vw-48px))]"
          )}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Hledat v RajmonData</DialogTitle>
          </DialogHeader>

          <div className="z-10 shrink-0 border-b bg-background px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <Sparkles className="h-4 w-4 text-blue-600 shrink-0" />
              Hledat v RajmonData
            </div>
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Hledejte zákazníka, doklad, fakturu, PDF, zakázku…"
              className="h-11 w-full"
            />
            {showKnowledgeHint ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  Dotaz vypadá jako otázka do manuálů — Enter nebo:
                </p>
                <Button type="button" size="sm" variant="secondary" onClick={askKnowledge}>
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  Zeptat se AI
                </Button>
              </div>
            ) : null}
          </div>

          {!query.trim() && recent.length > 0 ? (
            <div className="px-4 py-3 shrink-0 border-b">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Nedávné
              </p>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="rounded-full border px-3 py-1 text-sm hover:bg-muted"
                    onClick={() => setQuery(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {error ? <p className="px-4 py-3 text-sm text-destructive shrink-0">{error}</p> : null}

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-3 pt-2">
            <div className="space-y-3">
              {previewItem ? (
                <SearchInlineFilePreview
                  item={previewItem}
                  searchQuery={query}
                  onBack={() => setPreviewItem(null)}
                />
              ) : (
                <>
                  {knowledgeLoading ? (
                    <KnowledgeSearchAnswerCard
                      answer={{
                        found: false,
                        answerText: "",
                        sources: [],
                        relatedSources: [],
                        needsVisualContext: false,
                        primarySource: null,
                      }}
                      loading
                      compact
                    />
                  ) : response?.knowledgeAnswer ? (
                    <KnowledgeSearchAnswerCard answer={response.knowledgeAnswer} compact />
                  ) : null}

                  <SearchResultsList
                    results={response?.results ?? []}
                    activeIndex={activeIndex}
                    onActiveIndexChange={setActiveIndex}
                    onOpenResult={openResult}
                    onPreviewResult={openPreview}
                    loading={loading && !!query.trim() && !knowledgeLoading}
                    emptyMessage={emptyMessage}
                    summaryText={response?.summaryText}
                    compact
                  />
                </>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between border-t bg-background px-4 py-2 text-xs text-muted-foreground">
            <span>↑↓ · Enter náhled · Ctrl+Enter otevřít soubor · Esc</span>
            {response?.usedSemantic ? <span>Sémantické vyhledávání</span> : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
