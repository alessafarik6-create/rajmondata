"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { JobTemplate, JobTemplateValues } from "@/lib/job-templates";

type Props = {
  template: JobTemplate;
  values: JobTemplateValues;
  onChange: (values: JobTemplateValues) => void;
  /** Optional class for the container */
  className?: string;
};

export function JobTemplateFormFields({ template, values, onChange, className }: Props) {
  const setValue = (key: string, value: string | number | boolean | null) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className={className}>
      {template.sections
        .sort((a, b) => a.order - b.order)
        .map((section) => (
          <div key={section.id} className="space-y-3 mb-6">
            <h4 className="text-sm font-semibold text-slate-700 border-b border-slate-200 pb-1">
              {section.name}
            </h4>
            <div className="space-y-3 pl-0">
              {section.fields.map((field) => {
                const key = `${section.id}_${field.id}`;
                const value = values[key];
                return (
                  <div key={field.id} className="space-y-1.5">
                    <Label className="text-slate-700">
                      {field.label}
                      {field.required && <span className="text-destructive ml-0.5">*</span>}
                    </Label>
                    {field.type === "short_text" && (
                      <Input
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(key, e.target.value)}
                        placeholder={field.placeholder}
                        required={field.required}
                        className="bg-white border-slate-200"
                      />
                    )}
                    {field.type === "long_text" && (
                      <Textarea
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(key, e.target.value)}
                        placeholder={field.placeholder}
                        required={field.required}
                        rows={3}
                        className="bg-white border-slate-200"
                      />
                    )}
                    {field.type === "number" && (
                      <Input
                        type="number"
                        value={value !== null && value !== undefined ? String(value) : ""}
                        onChange={(e) => setValue(key, e.target.value === "" ? null : Number(e.target.value))}
                        placeholder={field.placeholder}
                        required={field.required}
                        className="bg-white border-slate-200"
                      />
                    )}
                    {field.type === "measurement" && (
                      <Input
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(key, e.target.value)}
                        placeholder={field.placeholder || "např. 3.5 m"}
                        required={field.required}
                        className="bg-white border-slate-200"
                      />
                    )}
                    {field.type === "checkbox" && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={value === true}
                          onCheckedChange={(c) => setValue(key, !!c)}
                        />
                        <span className="text-sm text-slate-600">Ano</span>
                      </div>
                    )}
                    {field.type === "select" && (
                      <Select
                        value={typeof value === "string" ? value : ""}
                        onValueChange={(v) => setValue(key, v)}
                        required={field.required}
                      >
                        <SelectTrigger className="bg-white border-slate-200">
                          <SelectValue placeholder={field.placeholder || "Vyberte..."} />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200">
                          {(field.options || []).map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {field.type === "date" && (
                      <Input
                        type="date"
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(key, e.target.value)}
                        required={field.required}
                        className="bg-white border-slate-200"
                      />
                    )}
                    {field.type === "notes" && (
                      <Textarea
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(key, e.target.value)}
                        placeholder={field.placeholder || "Poznámky..."}
                        rows={2}
                        className="bg-white border-slate-200"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
