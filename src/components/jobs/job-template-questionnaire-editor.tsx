"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  JOB_QUESTIONNAIRE_QUESTION_LABELS,
  JOB_QUESTIONNAIRE_QUESTION_TYPES,
  type JobQuestionnaireQuestion,
  type JobQuestionnaireQuestionType,
  type JobQuestionnaireTemplate,
} from "@/lib/job-customer-questionnaire";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

type Props = {
  value: JobQuestionnaireTemplate;
  onChange: (next: JobQuestionnaireTemplate) => void;
  generateId: () => string;
};

function defaultQuestion(idGen: () => string): JobQuestionnaireQuestion {
  return {
    id: idGen(),
    label: "Nová otázka",
    type: "short_text",
    required: false,
    order: 0,
    placeholder: "",
  };
}

export function JobTemplateQuestionnaireEditor({ value, onChange, generateId }: Props) {
  const setField = <K extends keyof JobQuestionnaireTemplate>(key: K, v: JobQuestionnaireTemplate[K]) => {
    onChange({ ...value, [key]: v });
  };

  const questions = [...(value.questions ?? [])].sort((a, b) => a.order - b.order);

  const updateQuestion = (index: number, q: JobQuestionnaireQuestion) => {
    const next = [...questions];
    next[index] = q;
    onChange({
      ...value,
      questions: next.map((x, i) => ({ ...x, order: i })),
    });
  };

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[index], next[j]] = [next[j], next[index]];
    onChange({
      ...value,
      questions: next.map((x, i) => ({ ...x, order: i })),
    });
  };

  const removeQuestion = (index: number) => {
    const next = questions.filter((_, i) => i !== index);
    onChange({
      ...value,
      questions: next.map((x, i) => ({ ...x, order: i })),
    });
  };

  const addQuestion = () => {
    onChange({
      ...value,
      questions: [...questions, { ...defaultQuestion(generateId), order: questions.length }],
    });
  };

  const optionsNeedingChoices = (t: JobQuestionnaireQuestionType) => t === "radio" || t === "checkbox_multi";

  return (
    <Card className="border-slate-200">
      <CardHeader className="py-3">
        <CardTitle className="text-base">Dotazník pro zákazníka</CardTitle>
        <p className="text-sm text-muted-foreground">
          Při vytvoření zakázky z této šablony se dotazník zkopíruje na zakázku. Zákazník ho vyplní v portálu.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="space-y-2 flex-1">
            <Label htmlFor="q-title">Název dotazníku</Label>
            <Input
              id="q-title"
              className="bg-white border-slate-200"
              value={value.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="Např. Údaje k realizaci"
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch
              id="q-active"
              checked={value.active !== false}
              onCheckedChange={(c) => setField("active", c)}
            />
            <Label htmlFor="q-active" className="cursor-pointer">
              Aktivní
            </Label>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="q-desc">Popis (volitelné)</Label>
          <Textarea
            id="q-desc"
            className="bg-white border-slate-200 min-h-[72px]"
            value={value.description ?? ""}
            onChange={(e) => setField("description", e.target.value)}
            placeholder="Krátký úvod pro zákazníka"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Label>Otázky</Label>
          <Button type="button" variant="outline" size="sm" onClick={addQuestion} className="gap-1">
            <Plus className="h-4 w-4" /> Přidat otázku
          </Button>
        </div>

        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
            Zatím žádné otázky — přidejte alespoň jednu pro smysluplný dotazník.
          </p>
        ) : (
          <ul className="space-y-3">
            {questions.map((q, idx) => (
              <li
                key={q.id}
                className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-3"
              >
                <div className="flex flex-wrap gap-2 items-start justify-between">
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">#{idx + 1}</span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Posunout nahoru"
                      disabled={idx === 0}
                      onClick={() => move(idx, -1)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Posunout dolů"
                      disabled={idx === questions.length - 1}
                      onClick={() => move(idx, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      aria-label="Smazat otázku"
                      onClick={() => removeQuestion(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Text otázky {q.required ? <span className="text-destructive">*</span> : null}</Label>
                    <Input
                      className="bg-white border-slate-200"
                      value={q.label}
                      onChange={(e) => updateQuestion(idx, { ...q, label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Typ</Label>
                    <select
                      className={NATIVE_SELECT_CLASS}
                      value={q.type}
                      onChange={(e) => {
                        const t = e.target.value as JobQuestionnaireQuestionType;
                        updateQuestion(idx, {
                          ...q,
                          type: t,
                          options: optionsNeedingChoices(t)
                            ? q.options && q.options.length > 0
                              ? q.options
                              : [
                                  { value: "a", label: "Možnost A" },
                                  { value: "b", label: "Možnost B" },
                                ]
                            : undefined,
                        });
                      }}
                    >
                      {JOB_QUESTIONNAIRE_QUESTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {JOB_QUESTIONNAIRE_QUESTION_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      id={`req-${q.id}`}
                      className="h-4 w-4 rounded border-slate-300"
                      checked={q.required}
                      onChange={(e) => updateQuestion(idx, { ...q, required: e.target.checked })}
                    />
                    <Label htmlFor={`req-${q.id}`} className="cursor-pointer font-normal">
                      Povinná otázka (hvězdička u zákazníka)
                    </Label>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Placeholder (volitelné)</Label>
                    <Input
                      className="bg-white border-slate-200"
                      value={q.placeholder ?? ""}
                      onChange={(e) => updateQuestion(idx, { ...q, placeholder: e.target.value || undefined })}
                      placeholder="Např. u data: RRRR-MM-DD"
                    />
                  </div>
                </div>
                {optionsNeedingChoices(q.type) ? (
                  <div className="space-y-2">
                    <Label>Možnosti odpovědí (každý řádek = jedna možnost)</Label>
                    <Textarea
                      className="bg-white border-slate-200 font-mono text-sm min-h-[88px]"
                      value={(q.options ?? []).map((o) => o.label || o.value).join("\n")}
                      onChange={(e) => {
                        const lines = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
                        const opts = lines.map((line, i) => ({
                          value: `opt_${i}_${line.slice(0, 24).replace(/\s+/g, "_")}`,
                          label: line,
                        }));
                        updateQuestion(idx, { ...q, options: opts });
                      }}
                      placeholder={"Možnost 1\nMožnost 2"}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
