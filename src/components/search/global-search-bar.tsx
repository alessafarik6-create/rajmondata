"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { useCompany, useUser } from "@/firebase";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchResultsList } from "@/components/search/search-results-list";
import {
  fetchCompanySearch,
  loadRecentSearches,
  pushRecentSearch,
} from "@/lib/search/client";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 320;

type GlobalSearchProps = {
  className?: string;
  dashboardDark?: boolean;
};

export function GlobalSearchBar({ className, dashboardDark }: GlobalSearchProps) {
  const router = useRouter();
  const { user } = useUser();
  const { companyId } = useCompany();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setRecent(loadRecentSearches());
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!user || !companyId || !q.trim()) {
        setResponse(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const data = await fetchCompanySearch({ token, companyId, query: q.trim(), limit: 20 });
        setResponse(data);
        setActiveIndex(data.results.length ? 0 : -1);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chyba vyhledávání");
        setResponse(null);
      } finally {
        setLoading(false);
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
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(query);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const results = response?.results ?? [];
    if (e.key === "Escape") {
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
        openResult(results[activeIndex]);
        return;
      }
      if (query.trim()) {
        e.preventDefault();
        pushRecentSearch(query.trim());
        setOpen(false);
        router.push(`/portal/search?q=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  return (
    <>
      <button
        type="button"
        className={cn(
          "relative hidden min-w-0 w-full max-w-md items-center sm:flex",
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
          placeholder="Hledejte zákazníka, doklad, fakturu, PDF, zakázku nebo napište dotaz…"
          className={cn("pl-10 cursor-pointer", dashboardDark && "bg-white/10 border-white/20 text-white placeholder:text-slate-300")}
        />
      </button>

      <button
        type="button"
        className="sm:hidden inline-flex h-10 w-10 items-center justify-center rounded-md border"
        onClick={() => setOpen(true)}
        aria-label="Hledat"
      >
        <Search className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-blue-600" />
              Hledat v RajmonData
            </DialogTitle>
          </DialogHeader>
          <div className="px-4 pt-3">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Hledejte zákazníka, doklad, fakturu, PDF, zakázku nebo napište dotaz…"
              className="h-11"
            />
          </div>

          {!query.trim() && recent.length > 0 ? (
            <div className="px-4 py-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Nedávné</p>
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

          {error ? <p className="px-4 py-3 text-sm text-destructive">{error}</p> : null}

          <SearchResultsList
            results={response?.results ?? []}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
            onOpenResult={openResult}
            loading={loading && !!query.trim()}
            compact
          />

          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <span>↑↓ navigace · Enter otevřít · Esc zavřít</span>
            {response?.usedSemantic ? <span>Sémantické vyhledávání</span> : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
