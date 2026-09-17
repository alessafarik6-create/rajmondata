"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { Firestore } from "firebase/firestore";
import type { User } from "firebase/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { logActivitySafe, type ActivityActorProfile } from "@/lib/activity-log";
import type {
  ContractTemplateAiMode,
  ContractTemplateAiScope,
  ContractTemplateAiStyle,
} from "@/lib/ai/contract-template-body-generation-service";

const CONTRACT_TYPES = [
  "Smlouva o dílo",
  "Rezervační smlouva",
  "Servisní smlouva",
  "Předávací dokument / jiný dokument",
  "Vlastní",
] as const;

export type ContractTemplateAiModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | null | undefined;
  firestore: Firestore | null;
  user: User | null | undefined;
  profile?: ActivityActorProfile | null;
  /** Text currently in the main editor (for improve / compare). */
  existingContent: string;
  /** Initial mode when opening. */
  initialMode: "generate" | "improve";
  onApplyText: (text: string) => void;
};

export function ContractTemplateAiModal({
  open,
  onOpenChange,
  companyId,
  firestore,
  user,
  profile,
  existingContent,
  initialMode,
  onApplyText,
}: ContractTemplateAiModalProps) {
  const [contractType, setContractType] = useState<string>(CONTRACT_TYPES[0]);
  const [userBrief, setUserBrief] = useState("");
  const [scope, setScope] = useState<ContractTemplateAiScope>("standard");
  const [style, setStyle] = useState<ContractTemplateAiStyle>("professional");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [originalSnapshot, setOriginalSnapshot] = useState("");
  const [hasGenerated, setHasGenerated] = useState(false);

  const isImproveContext =
    initialMode === "improve" || existingContent.trim().length > 0;

  useEffect(() => {
    if (!open) {
      setUserBrief("");
      setError(null);
      setDraftText("");
      setHasGenerated(false);
      setOriginalSnapshot("");
      setContractType(CONTRACT_TYPES[0]);
      setScope("standard");
      setStyle("professional");
      setLoading(false);
      return;
    }
    if (isImproveContext) {
      setOriginalSnapshot(existingContent);
    }
  }, [open, existingContent, isImproveContext]);

  const runAi = useCallback(
    async (mode: ContractTemplateAiMode) => {
      if (!companyId || !user) {
        setError("Chybí přihlášení nebo firma.");
        return;
      }
      const brief = userBrief.trim();
      if (brief.length < 8) {
        setError("Popište požadavek (alespoň několik slov).");
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/company/contract-templates/ai-body", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyId,
            mode,
            contractType,
            scope,
            style,
            userBrief: brief,
            existingContent:
              mode === "generate" && !isImproveContext
                ? ""
                : existingContent || originalSnapshot,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; text?: string; error?: string };
        if (!res.ok || !data.ok || !data.text) {
          setError(data.error || "Návrh se nepodařilo vytvořit. Zkuste to znovu.");
          return;
        }
        setDraftText(data.text);
        setHasGenerated(true);
        if (!originalSnapshot.trim() && existingContent.trim()) {
          setOriginalSnapshot(existingContent);
        }
      } catch {
        setError("Návrh se nepodařilo vytvořit. Zkuste to znovu.");
      } finally {
        setLoading(false);
      }
    },
    [
      companyId,
      user,
      userBrief,
      contractType,
      scope,
      style,
      existingContent,
      originalSnapshot,
      isImproveContext,
    ]
  );

  const handleApply = () => {
    const text = draftText.trim();
    if (!text) return;
    onApplyText(text);
    const improved = isImproveContext || originalSnapshot.trim().length > 0;
    logActivitySafe(firestore, companyId ?? undefined, user, profile ?? null, {
      actionType: improved
        ? "contract_template.ai_body_improved"
        : "contract_template.ai_body_generated",
      actionLabel: improved
        ? "Obsah smluvní šablony byl upraven pomocí AI"
        : "AI vytvořila návrh obsahu smluvní šablony",
      entityType: "contract_template",
      entityName: null,
      details: improved
        ? "Uživatel použil AI návrh úpravy těla šablony (bez uložení celého textu do logu)."
        : "Uživatel vložil AI návrh těla šablony do editoru.",
      sourceModule: "contracts",
      metadata: {
        contractType,
        scope,
        style,
        mode: improved ? "improve" : "generate",
      },
    });
    onOpenChange(false);
  };

  const title = isImproveContext
    ? "Upravit obsah smlouvy pomocí AI"
    : "Vytvořit obsah smlouvy pomocí AI";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,900px)] w-[calc(100vw-1rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-slate-200 px-4 py-4 sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-lg text-slate-950">
            <Sparkles className="h-5 w-5 text-violet-600" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-slate-700">
            AI připraví pouze univerzální tělo šablony — hlavičku, strany a podpisy doplní aplikace
            při vytvoření smlouvy u zakázky.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ct-ai-type">Typ smlouvy</Label>
              <Select value={contractType} onValueChange={setContractType} disabled={loading}>
                <SelectTrigger id="ct-ai-type" className="min-h-10 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ct-ai-brief">
                {isImproveContext ? "Co má AI upravit nebo doplnit?" : "Popište, co má smlouva řešit"}
              </Label>
              <Textarea
                id="ct-ai-brief"
                value={userBrief}
                onChange={(e) => setUserBrief(e.target.value)}
                disabled={loading}
                placeholder={
                  isImproveContext
                    ? "Např. doplň ustanovení o vícepracích, zpřesni platební podmínky…"
                    : "Vytvoř univerzální obsah smlouvy o dílo pro dodávku a montáž zimní zahrady. Chci řešit cenu díla, zálohy, termín realizace, stavební připravenost, vícepráce, předání díla, reklamace, záruku, součinnost objednatele a odstoupení od smlouvy."
                }
                className="min-h-[120px] resize-y bg-white text-sm"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Rozsah</Label>
                <div className="flex flex-col gap-2">
                  {(
                    [
                      ["short", "Stručný"],
                      ["standard", "Standardní"],
                      ["detailed", "Podrobný"],
                    ] as const
                  ).map(([val, label]) => (
                    <label
                      key={val}
                      className={cn(
                        "flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm",
                        scope === val
                          ? "border-violet-400 bg-violet-50"
                          : "border-slate-200 bg-white"
                      )}
                    >
                      <input
                        type="radio"
                        name="ct-ai-scope"
                        className="h-4 w-4"
                        checked={scope === val}
                        disabled={loading}
                        onChange={() => setScope(val)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Styl</Label>
                <div className="flex flex-col gap-2">
                  {(
                    [
                      ["professional", "Běžný profesionální"],
                      ["formal", "Formální právní"],
                    ] as const
                  ).map(([val, label]) => (
                    <label
                      key={val}
                      className={cn(
                        "flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm",
                        style === val
                          ? "border-violet-400 bg-violet-50"
                          : "border-slate-200 bg-white"
                      )}
                    >
                      <input
                        type="radio"
                        name="ct-ai-style"
                        className="h-4 w-4"
                        checked={style === val}
                        disabled={loading}
                        onChange={() => setStyle(val)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {!hasGenerated ? (
              <Button
                type="button"
                className="min-h-11 w-full gap-2 bg-violet-600 hover:bg-violet-700"
                disabled={loading || userBrief.trim().length < 8}
                onClick={() =>
                  void runAi(isImproveContext && existingContent.trim() ? "improve" : "generate")
                }
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {isImproveContext ? "Připravit AI návrh úpravy" : "Vygenerovat návrh obsahu"}
              </Button>
            ) : null}

            {loading ? (
              <p className="text-sm text-violet-900">✨ AI připravuje návrh obsahu smlouvy…</p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            {hasGenerated && draftText ? (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <p className="text-sm font-semibold text-slate-900">AI návrh obsahu</p>
                {originalSnapshot.trim() ? (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Původní text</Label>
                      <Textarea
                        readOnly
                        value={originalSnapshot}
                        className="min-h-[200px] resize-y bg-slate-50 text-xs sm:text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">AI návrh</Label>
                      <Textarea
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        className="min-h-[200px] resize-y bg-white text-xs sm:text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  <Textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    className="min-h-[240px] resize-y bg-white text-sm"
                  />
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-10 w-full sm:w-auto"
                    disabled={loading || userBrief.trim().length < 8}
                    onClick={() => void runAi("regenerate")}
                  >
                    Přegenerovat
                  </Button>
                  <Button
                    type="button"
                    className="min-h-10 w-full sm:w-auto bg-orange-500 hover:bg-orange-600"
                    disabled={loading || !draftText.trim()}
                    onClick={handleApply}
                  >
                    Použít tento text
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-10 w-full sm:w-auto"
                    disabled={loading}
                    onClick={() => onOpenChange(false)}
                  >
                    Zrušit
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-10"
                  disabled={loading}
                  onClick={() => onOpenChange(false)}
                >
                  Zrušit
                </Button>
              </div>
            )}

            <p className="text-xs text-slate-500">
              AI vytváří návrh textu. Před použitím smlouvy zkontrolujte správnost a vhodnost
              ustanovení pro konkrétní případ.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
