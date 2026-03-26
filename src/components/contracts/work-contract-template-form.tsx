"use client";

import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIGHT_FORM_CONTROL_CLASS } from "@/lib/light-form-control-classes";
import {
  CONTRACT_TEMPLATE_PLACEHOLDER_HELP,
  CONTRACT_TEMPLATE_PLACEHOLDER_KEYS,
} from "@/lib/contract-template-placeholders";

const FIELD = cn(
  LIGHT_FORM_CONTROL_CLASS,
  "min-h-[44px] md:min-h-10 shadow-sm"
);

const TEXTAREA_FIELD = cn(
  LIGHT_FORM_CONTROL_CLASS,
  "min-h-[220px] w-full resize-y shadow-sm sm:min-h-[280px] md:min-h-[min(52vh,560px)]"
);

export type WorkContractTemplateFormProps = {
  disabled: boolean;
  editingId: string | null;
  name: string;
  content: string;
  onNameChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  saving: boolean;
  onCancel?: () => void;
};

/**
 * Formulář šablony SOD. Nativní overflow místo ScrollArea (stabilita uvnitř dialogu).
 */
export function WorkContractTemplateForm({
  disabled,
  editingId,
  name,
  content,
  onContentChange,
  onNameChange,
  onSubmit,
  saving,
  onCancel,
}: WorkContractTemplateFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertPlaceholder = (key: (typeof CONTRACT_TEMPLATE_PLACEHOLDER_KEYS)[number]) => {
    const snippet = `{{${key}}}`;
    const ta = textareaRef.current;
    if (!ta) {
      onContentChange(content + snippet);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = content.slice(0, start) + snippet + content.slice(end);
    onContentChange(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
      <div className="h-[50vh] min-h-0 flex-1 overflow-y-auto lg:h-[calc(92vh-200px)]">
        <div className="mx-auto w-full max-w-none space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="space-y-1 pb-3">
              <CardTitle className="text-base text-slate-900">
                {editingId ? "Úprava šablony" : "Nová šablona"}
              </CardTitle>
              <CardDescription className="text-slate-800">
                {editingId
                  ? `Upravujete uloženou šablonu${editingId ? ` (ID: ${editingId})` : ""}.`
                  : "Vyplňte název a text smlouvy. Po uložení bude šablona k dispozici u zakázek."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <Label htmlFor="wct-form-name" className="text-slate-900">
                Název šablony
              </Label>
              <Input
                id="wct-form-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="např. Smlouva o dílo – standard"
                disabled={disabled}
                className={FIELD}
              />
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="space-y-1 pb-3">
              <CardTitle className="text-base text-slate-900">Obsah smlouvy</CardTitle>
              <CardDescription>
                Hlavní text dokumentu. Na velké obrazovce má editor více místa — posuňte okrajem
                okna dialogu.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Textarea
                ref={textareaRef}
                id="wct-form-content"
                value={content}
                onChange={(e) => onContentChange(e.target.value)}
                placeholder="Text smlouvy… Můžete vložit proměnné v sekci níže."
                disabled={disabled}
                className={TEXTAREA_FIELD}
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6 xl:gap-8">
            <Card className="border-dashed border-orange-200 bg-orange-50/50 shadow-sm dark:bg-orange-950/20">
              <CardHeader className="space-y-1 pb-2">
                <CardTitle className="text-base text-slate-900">
                  Vložit dynamickou proměnnou
                </CardTitle>
                <CardDescription className="text-slate-700">
                  Po vytvoření smlouvy u zakázky se zástupné výrazy (např.{" "}
                  <code className="rounded bg-white px-1 text-xs dark:bg-slate-900">
                    {"{{zalohova_castka}}"}
                  </code>
                  ) nahradí skutečnými údaji.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-2">
                  {CONTRACT_TEMPLATE_PLACEHOLDER_KEYS.map((key) => (
                    <Button
                      key={key}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-auto min-h-[40px] border-slate-300 bg-white px-2.5 py-2 font-mono text-xs text-black hover:bg-slate-50 dark:bg-slate-950"
                      disabled={disabled}
                      onClick={() => insertPlaceholder(key)}
                      title={`Vložit {{${key}}}`}
                    >
                      {`{{${key}}}`}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-slate-50/80 shadow-sm dark:bg-slate-950/40">
              <CardHeader className="space-y-1 pb-2">
                <CardTitle className="text-base text-slate-900">Popis proměnných</CardTitle>
                <CardDescription className="text-slate-800">
                  Přehled významů a formátů pro správné šablony.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="max-h-[min(40vh,320px)] overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-800">
                  {CONTRACT_TEMPLATE_PLACEHOLDER_HELP}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:justify-end sm:px-6 lg:px-8">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] border-slate-300 bg-white text-black"
            disabled={disabled || saving}
            onClick={onCancel}
          >
            Zavřít
          </Button>
        ) : null}
        <Button
          type="button"
          className="min-h-[44px] border-0 bg-orange-500 text-white hover:bg-orange-600"
          disabled={disabled || saving}
          onClick={() => void onSubmit()}
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Ukládám…
            </>
          ) : editingId ? (
            "Uložit změny"
          ) : (
            "Vytvořit šablonu"
          )}
        </Button>
      </div>
    </div>
  );
}
