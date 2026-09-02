"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, Sparkles } from "lucide-react";
import { useCompany, useUser } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchResultsList } from "@/components/search/search-results-list";
import { fetchCompanySearch, pushRecentSearch } from "@/lib/search/client";
import type { SearchEntityType, SearchResponse } from "@/lib/search/types";

const ENTITY_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Vše" },
  { value: "document", label: "Doklady" },
  { value: "invoice", label: "Faktury" },
  { value: "offer", label: "Nabídky" },
  { value: "job", label: "Zakázky" },
  { value: "customer", label: "Zákazníci" },
  { value: "inquiry", label: "Poptávky" },
];

export default function PortalSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const { user, isUserLoading } = useUser();
  const { companyId } = useCompany();

  const [query, setQuery] = useState(initialQ);
  const [entityFilter, setEntityFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);

  const filters = useMemo(() => {
    const entityTypes =
      entityFilter === "all" ? null : ([entityFilter] as SearchEntityType[]);
    return {
      entityTypes,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      amountMin: amountMin ? Number(amountMin.replace(",", ".")) : null,
      amountMax: amountMax ? Number(amountMax.replace(",", ".")) : null,
    };
  }, [entityFilter, dateFrom, dateTo, amountMin, amountMax]);

  const runSearch = useCallback(async () => {
    if (!user || !companyId || !query.trim()) {
      setResponse(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const data = await fetchCompanySearch({
        token,
        companyId,
        query: query.trim(),
        filters,
        limit: 40,
      });
      setResponse(data);
      pushRecentSearch(query.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vyhledávání se nezdařilo.");
    } finally {
      setLoading(false);
    }
  }, [user, companyId, query, filters]);

  useEffect(() => {
    if (initialQ && user && companyId) {
      void runSearch();
    }
  }, [initialQ, user, companyId, runSearch]);

  if (isUserLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-600" />
            AI vyhledávání
          </CardTitle>
          <CardDescription>
            Přirozený jazyk i klasické filtry — doklady, faktury, zakázky, zákazníci a další.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch();
                }}
                placeholder="Co hledáte?"
                className="pl-10"
              />
            </div>
            <Button onClick={() => void runSearch()} disabled={loading || !query.trim()}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Hledat
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label>Typ</Label>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_FILTER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Datum od</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Datum do</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Částka od / do (Kč)</Label>
              <div className="flex gap-2">
                <Input
                  inputMode="decimal"
                  placeholder="Od"
                  value={amountMin}
                  onChange={(e) => setAmountMin(e.target.value)}
                />
                <Input
                  inputMode="decimal"
                  placeholder="Do"
                  value={amountMax}
                  onChange={(e) => setAmountMax(e.target.value)}
                />
              </div>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {response ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                {response.total ?? response.results.length} výsledků · {response.tookMs} ms
                {response.usedSemantic ? " · sémantické vyhledávání" : ""}
                {response.usedAiParser ? " · AI parser" : ""}
                {response.intent?.entityListing ? " · listing entit" : ""}
              </p>
              {process.env.NODE_ENV === "development" && response.meta ? (
                <p className="font-mono text-[11px]">
                  Index: {response.meta.indexTotal} · Live fallback:{" "}
                  {response.meta.usedLiveFallback ? "ano" : "ne"} · Kandidáti:{" "}
                  {response.meta.candidatesTotal} · Exact: {response.meta.exactCount} · Fulltext:{" "}
                  {response.meta.fulltextCount} · Semantic: {response.meta.semanticCount} · Listing:{" "}
                  {response.meta.listingCount}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <SearchResultsList
            results={response?.results ?? []}
            loading={loading}
            emptyMessage={query.trim() ? "Nic nenalezeno" : "Zadejte dotaz"}
            onOpenResult={(item) => router.push(item.openUrl)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
