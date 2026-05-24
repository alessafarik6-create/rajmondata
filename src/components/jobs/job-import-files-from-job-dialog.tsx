"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  buildJobImportSearchRows,
  filterJobsForMediaImport,
  formatImportFileSize,
  JOB_MEDIA_IMPORT_CATEGORY_LABELS,
  type JobImportJobSearchRow,
  type JobMediaImportCategory,
  type JobMediaImportListItem,
  type JobMediaImportSelectionRef,
} from "@/lib/job-media-import-types";
import { jobTagLabel } from "@/lib/job-tags";
import {
  FileText,
  ImageIcon,
  Loader2,
  Search,
  Files,
} from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  targetJobId: string;
  jobDisplayName?: string | null;
  user: User;
  jobs?: Record<string, unknown>[] | null;
  customersById?: Map<string, Record<string, unknown>> | null;
  onImported?: () => void;
};

function itemKey(it: JobMediaImportListItem): string {
  return it.kind === "legacyPhoto" ? `legacy:${it.id}` : `folder:${it.folderId}:${it.id}`;
}

function selectionFromItem(it: JobMediaImportListItem): JobMediaImportSelectionRef {
  return {
    kind: it.kind,
    id: it.id,
    ...(it.folderId ? { folderId: it.folderId } : {}),
  };
}

function fileTypeLabel(ft: string): string {
  if (ft === "pdf") return "PDF";
  if (ft === "image") return "Obrázek";
  if (ft === "office") return "Office";
  if (ft === "csv") return "CSV";
  return ft;
}

export function JobImportFilesFromJobDialog({
  open,
  onOpenChange,
  companyId,
  targetJobId,
  jobDisplayName = null,
  user,
  jobs,
  customersById,
  onImported,
}: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<"job" | "files">("job");
  const [jobSearch, setJobSearch] = useState("");
  const [sourceJobId, setSourceJobId] = useState("");
  const [sourceJobLabel, setSourceJobLabel] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [items, setItems] = useState<JobMediaImportListItem[]>([]);
  const [category, setCategory] = useState<JobMediaImportCategory | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const jobRows = useMemo(
    () =>
      filterJobsForMediaImport(
        buildJobImportSearchRows(
          (jobs ?? []).filter((j) => String(j.id ?? "").trim() !== targetJobId),
          customersById ?? new Map()
        ),
        jobSearch,
        jobTagLabel
      ),
    [jobs, customersById, jobSearch, targetJobId]
  );

  const resetState = useCallback(() => {
    setStep("job");
    setJobSearch("");
    setSourceJobId("");
    setSourceJobLabel("");
    setItems([]);
    setCategory("all");
    setSelected(new Set());
  }, []);

  useEffect(() => {
    if (!open) resetState();
  }, [open, resetState]);

  const loadSourceFiles = useCallback(
    async (jobId: string) => {
      setListLoading(true);
      setItems([]);
      setSelected(new Set());
      try {
        const token = await user.getIdToken();
        const url = new URL("/api/company/jobs/import-media", window.location.origin);
        url.searchParams.set("companyId", companyId);
        url.searchParams.set("sourceJobId", jobId);
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as {
          ok?: boolean;
          items?: JobMediaImportListItem[];
          error?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Nepodařilo se načíst soubory.");
        }
        setItems(data.items ?? []);
        setStep("files");
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Chyba načtení",
          description: e instanceof Error ? e.message : "Nepodařilo se načíst soubory.",
        });
      } finally {
        setListLoading(false);
      }
    },
    [companyId, user, toast]
  );

  const filteredItems = useMemo(() => {
    const list = items ?? [];
    if (category === "all") return list;
    return list.filter((it) => (it.categories ?? []).includes(category));
  }, [items, category]);

  const categoryCounts = useMemo(() => {
    const m = new Map<JobMediaImportCategory, number>();
    for (const it of items ?? []) {
      for (const c of it.categories ?? []) {
        m.set(c, (m.get(c) ?? 0) + 1);
      }
    }
    return m;
  }, [items]);

  const toggleOne = (key: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAllVisible = (on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const it of filteredItems) {
        const k = itemKey(it);
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  const allVisibleSelected =
    filteredItems.length > 0 &&
    filteredItems.every((it) => selected.has(itemKey(it)));

  const confirmImport = async () => {
    const refs: JobMediaImportSelectionRef[] = [];
    for (const it of items ?? []) {
      const k = itemKey(it);
      if (selected.has(k)) refs.push(selectionFromItem(it));
    }
    if (!refs.length) {
      toast({
        variant: "destructive",
        title: "Žádný výběr",
        description: "Označte alespoň jeden soubor.",
      });
      return;
    }
    setImporting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/jobs/import-media", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId,
          sourceJobId,
          targetJobId,
          jobDisplayName,
          items: refs,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        copied?: number;
        failed?: string[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Import se nezdařil.");
      }
      const copied = data.copied ?? 0;
      const failed = data.failed?.length ?? 0;
      toast({
        title: "Import dokončen",
        description:
          failed > 0
            ? `Zkopírováno ${copied} souborů, ${failed} se nepodařilo.`
            : `Zkopírováno ${copied} souborů do této zakázky.`,
      });
      onImported?.();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Import selhal",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setImporting(false);
    }
  };

  const formatJobRow = (r: JobImportJobSearchRow) => {
    const parts = [
      r.name || "Bez názvu",
      r.contractNumber ? `č. ${r.contractNumber}` : null,
      r.customerName || null,
      r.addressLine || null,
      r.jobTag || null,
      r.status || null,
    ].filter(Boolean);
    return parts.join(" · ");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,900px)] max-w-3xl overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Files className="h-5 w-5 text-primary" aria-hidden />
            Importovat soubory z jiné zakázky
          </DialogTitle>
          <DialogDescription>
            Soubory se zkopírují včetně metadat, poznámek a anotací. V původní zakázce zůstanou beze změny.
          </DialogDescription>
        </DialogHeader>

        {step === "job" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="import-job-search">Vyhledat zakázku</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="import-job-search"
                  className="pl-9"
                  placeholder="Číslo, název, zákazník, adresa, typ, datum…"
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                />
              </div>
            </div>
            <ul
              className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border divide-y max-h-[min(50vh,420px)]"
              role="listbox"
              aria-label="Seznam zakázek"
            >
              {jobRows.length === 0 ? (
                <li className="p-4 text-sm text-muted-foreground">Žádná zakázka neodpovídá hledání.</li>
              ) : (
                jobRows.slice(0, 80).map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={cn(
                        "w-full px-3 py-2.5 text-left text-sm hover:bg-muted/60 transition-colors",
                        sourceJobId === r.id && "bg-primary/10"
                      )}
                      disabled={listLoading}
                      onClick={() => {
                        setSourceJobId(r.id);
                        setSourceJobLabel(formatJobRow(r));
                        void loadSourceFiles(r.id);
                      }}
                    >
                      <span className="font-medium text-foreground line-clamp-1">
                        {r.name || "Zakázka"}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-2">
                        {formatJobRow(r)}
                      </span>
                      {r.createdAtMs != null ? (
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          Vytvořeno:{" "}
                          {new Date(r.createdAtMs).toLocaleDateString("cs-CZ")}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
            {listLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítání souborů…
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="text-muted-foreground line-clamp-2 min-w-0 flex-1">
                Zdroj: <span className="font-medium text-foreground">{sourceJobLabel}</span>
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 h-8"
                onClick={() => {
                  setStep("job");
                  setItems([]);
                  setSelected(new Set());
                }}
              >
                Změnit zakázku
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={category === "all" ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setCategory("all")}
              >
                Vše ({items.length})
              </Button>
              {(Object.keys(JOB_MEDIA_IMPORT_CATEGORY_LABELS) as JobMediaImportCategory[]).map(
                (c) => {
                  const n = categoryCounts.get(c) ?? 0;
                  if (n === 0) return null;
                  return (
                    <Button
                      key={c}
                      type="button"
                      size="sm"
                      variant={category === c ? "default" : "outline"}
                      className="h-8 text-xs"
                      onClick={() => setCategory(c)}
                    >
                      {JOB_MEDIA_IMPORT_CATEGORY_LABELS[c]} ({n})
                    </Button>
                  );
                }
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-y border-border py-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={(v) => toggleAllVisible(v === true)}
                />
                Označit vše ve filtru ({filteredItems.length})
              </label>
              <span className="text-xs text-muted-foreground">
                Vybráno: {selected.size}
              </span>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto space-y-2 max-h-[min(48vh,400px)] pr-1">
              {filteredItems.length === 0 ? (
                <li className="text-sm text-muted-foreground py-4 text-center">
                  V této kategorii nejsou soubory.
                </li>
              ) : (
                filteredItems.map((it) => {
                  const k = itemKey(it);
                  const checked = selected.has(k);
                  const isImage =
                    it.fileType === "image" && it.previewUrl.startsWith("http");
                  return (
                    <li
                      key={k}
                      className={cn(
                        "flex gap-3 rounded-lg border p-2.5 transition-colors",
                        checked ? "border-primary/40 bg-primary/5" : "border-border"
                      )}
                    >
                      <Checkbox
                        className="mt-3 shrink-0"
                        checked={checked}
                        onCheckedChange={(v) => toggleOne(k, v === true)}
                        aria-label={`Vybrat ${it.fileName}`}
                      />
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted flex items-center justify-center">
                        {isImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={it.previewUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : it.fileType === "pdf" ? (
                          <FileText className="h-8 w-8 text-red-600" aria-hidden />
                        ) : (
                          <ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium text-sm truncate">{it.fileName}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            {fileTypeLabel(it.fileType)}
                          </Badge>
                          {it.folderName ? (
                            <Badge variant="outline" className="text-[10px] font-normal">
                              {it.folderName}
                            </Badge>
                          ) : it.kind === "legacyPhoto" ? (
                            <Badge variant="outline" className="text-[10px] font-normal">
                              Fotodokumentace
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatImportFileSize(it.sizeBytes)} ·{" "}
                          {it.createdAtMs
                            ? new Date(it.createdAtMs).toLocaleString("cs-CZ")
                            : "—"}
                          {it.annotationCount > 0
                            ? ` · ${it.annotationCount} anotací`
                            : ""}
                        </p>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )}

        <DialogFooter className="px-6 py-4 border-t shrink-0 gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          {step === "files" ? (
            <Button
              type="button"
              disabled={importing || selected.size === 0}
              onClick={() => void confirmImport()}
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Kopírování…
                </>
              ) : (
                `Importovat (${selected.size})`
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
