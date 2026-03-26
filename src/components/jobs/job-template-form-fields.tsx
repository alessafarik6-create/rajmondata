"use client";

import React, { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { JobTemplate, JobTemplateSection, JobTemplateValues } from "@/lib/job-templates";
import { cn } from "@/lib/utils";
import {
  LIGHT_FORM_CONTROL_CLASS,
  LIGHT_SELECT_CONTENT_CLASS,
  LIGHT_SELECT_TRIGGER_CLASS,
} from "@/lib/light-form-control-classes";

type Props = {
  template: JobTemplate;
  values: JobTemplateValues;
  onChange: (values: JobTemplateValues) => void;
  /** Optional class for the container */
  className?: string;
};

function normalizeSections(template: JobTemplate | null | undefined): JobTemplateSection[] {
  const raw = template?.sections;
  if (!Array.isArray(raw)) return [];
  return [...raw].sort((a, b) => {
    const ao = typeof a?.order === "number" ? a.order : 0;
    const bo = typeof b?.order === "number" ? b.order : 0;
    return ao - bo;
  });
}

export function JobTemplateFormFields({ template, values, onChange, className }: Props) {
  const setValue = (key: string, value: string | number | boolean | null) => {
    onChange({ ...values, [key]: value });
  };

  const sections = useMemo(() => normalizeSections(template), [template]);

  if (!template || typeof template !== "object") {
    return (
      <p className="text-sm text-slate-800">
        Neplatná šablona — nelze zobrazit pole.
      </p>
    );
  }

  if (sections.length === 0) {
    return (
      <p className="text-sm text-slate-800">
        Šablona zatím nemá definovaná pole (chybí sekce v datech).
      </p>
    );
  }

  return (
    <div className={className}>
      {sections.map((section) => {
        const sectionId = section?.id ?? "section";
        const fields = Array.isArray(section?.fields) ? section.fields : [];
        return (
          <div key={sectionId} className="space-y-3 mb-6">
            <h4 className="text-sm font-semibold text-slate-700 border-b border-slate-200 pb-1">
              {section?.name ?? "Sekce"}
            </h4>
            <div className="space-y-3 pl-0">
              {fields.map((field) => {
                if (!field || typeof field !== "object") return null;
                const fid = field.id ?? "field";
                const key = `${sectionId}_${fid}`;
                const value = values[key];
                const ftype = field.type;

                return (
                  <div key={fid} className="space-y-1.5">
                    <Label className="text-slate-700">
                      {field.label ?? fid}
                      {field.required && <span className="text-destructive ml-0.5">*</span>}
                    </Label>
                    {ftype === "short_text" && (
                      <Input
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(key, e.target.value)}
                        placeholder={field.placeholder}
                        required={field.required}
                        className={cn(LIGHT_FORM_CONTROL_CLASS)}
                      />
                    )}
                    {ftype === "long_text" && (
                      <Textarea
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(key, e.target.value)}
                        placeholder={field.placeholder}
                        required={field.required}
                        rows={3}
                        className={cn(LIGHT_FORM_CONTROL_CLASS)}
                      />
                    )}
                    {ftype === "number" && (
                      <Input
                        type="number"
                        value={value !== null && value !== undefined ? String(value) : ""}
                        onChange={(e) =>
                          setValue(key, e.target.value === "" ? null : Number(e.target.value))
                        }
                        placeholder={field.placeholder}
                        required={field.required}
                        className={cn(LIGHT_FORM_CONTROL_CLASS)}
                      />
                    )}
                    {ftype === "measurement" && (
                      <Input
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(key, e.target.value)}
                        placeholder={field.placeholder || "např. 3.5 m"}
                        required={field.required}
                        className={cn(LIGHT_FORM_CONTROL_CLASS)}
                      />
                    )}
                    {ftype === "checkbox" && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={value === true}
                          onCheckedChange={(c) => setValue(key, !!c)}
                        />
                        <span className="text-sm text-slate-800">Ano</span>
                      </div>
                    )}
                    {ftype === "select" && (() => {
                      const raw = typeof value === "string" ? value : "";
                      const selectValue = raw.length > 0 ? raw : undefined;
                      const options = (field.options ?? []).filter(
                        (opt) => opt && typeof opt.value === "string" && opt.value.length > 0
                      );
                      if (options.length === 0) {
                        return (
                          <p className="text-xs text-destructive">
                            Pole výběru nemá žádné platné možnosti.
                          </p>
                        );
                      }
                      return (
                        <Select
                          value={selectValue}
                          onValueChange={(v) => setValue(key, v)}
                          required={field.required}
                        >
                          <SelectTrigger className={cn(LIGHT_SELECT_TRIGGER_CLASS)}>
                            <SelectValue placeholder={field.placeholder || "Vyberte..."} />
                          </SelectTrigger>
                          <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                            {options.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label ?? opt.value}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                    {ftype === "date" && (
                      <Input
                        type="date"
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(key, e.target.value)}
                        required={field.required}
                        className={cn(LIGHT_FORM_CONTROL_CLASS, "[color-scheme:light]")}
                      />
                    )}
                    {ftype === "notes" && (
                      <Textarea
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(key, e.target.value)}
                        placeholder={field.placeholder || "Poznámky..."}
                        rows={2}
                        className={cn(LIGHT_FORM_CONTROL_CLASS)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
