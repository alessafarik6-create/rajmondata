"use client";

import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  "min-h-[200px] resize-y shadow-sm"
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="h-[50vh] min-h-0 flex-1 overflow-y-auto lg:h-[calc(90vh-220px)]">
        <div className="space-y-4 p-6">
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-black">
            <span className="font-semibold">
              {editingId ? "Úprava šablony" : "Nová šablona"}
            </span>
            {editingId ? (
              <span className="ml-2 text-slate-600">(ID: {editingId})</span>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="wct-form-name" className="text-black">
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="wct-form-content" className="text-black">
              Obsah smlouvy
            </Label>
            <Textarea
              ref={textareaRef}
              id="wct-form-content"
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              placeholder="Text smlouvy… Můžete vložit proměnné níže."
              disabled={disabled}
              className={TEXTAREA_FIELD}
            />
          </div>

          <div className="rounded-lg border border-dashed border-orange-200 bg-orange-50/60 p-4 text-sm text-slate-800">
            <p className="mb-2 font-semibold text-black">
              Vložit dynamickou proměnnou
            </p>
            <p className="mb-3 text-xs text-slate-600">
              Po vytvoření smlouvy u zakázky se zástupné výrazy (např.{" "}
              <code className="rounded bg-white px-1">{"{{zalohova_castka}}"}</code>) nahradí
              skutečnými údaji — v editoru zůstávají ve tvaru se závorkami.
            </p>
            <div className="flex flex-wrap gap-2">
              {CONTRACT_TEMPLATE_PLACEHOLDER_KEYS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-auto min-h-[36px] border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-black hover:bg-slate-50"
                  disabled={disabled}
                  onClick={() => insertPlaceholder(key)}
                  title={`Vložit {{${key}}}`}
                >
                  {`{{${key}}}`}
                </Button>
              ))}
            </div>
          </div>

          <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
            <p className="mb-2 font-semibold text-black">Popis proměnných</p>
            {CONTRACT_TEMPLATE_PLACEHOLDER_HELP}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-6 py-4 sm:flex-row sm:justify-end">
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
