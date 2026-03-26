"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type { JobTemplateField, JobTemplateFieldType } from "@/lib/job-templates";
import { JOB_TEMPLATE_FIELD_LABELS } from "@/lib/job-templates";
import { Trash2, GripVertical } from "lucide-react";

type Props = {
  field: JobTemplateField;
  onChange: (f: JobTemplateField) => void;
  onRemove: () => void;
};

export function JobTemplateFieldEditor({ field, onChange, onRemove }: Props) {
  const update = (patch: Partial<JobTemplateField>) =>
    onChange({ ...field, ...patch });

  return (
    <div className="flex gap-2 items-start p-3 rounded-lg border border-slate-200 bg-slate-50/50">
      <div className="pt-2 text-slate-800 cursor-grab">
        <GripVertical className="w-4 h-4" />
      </div>
      <div className="flex-1 grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label className="text-xs">Název pole</Label>
          <Input
            value={field.label}
            onChange={(e) => update({ label: e.target.value })}
            placeholder="Např. Šířka"
            className="mt-1 bg-white border-slate-200"
          />
        </div>
        <div>
          <Label className="text-xs">Typ</Label>
          <Select
            value={field.type}
            onValueChange={(v) => update({ type: v as JobTemplateFieldType })}
          >
            <SelectTrigger className="mt-1 bg-white border-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200">
              {(Object.entries(JOB_TEMPLATE_FIELD_LABELS) as [JobTemplateFieldType, string][]).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={!!field.required}
              onCheckedChange={(c) => update({ required: !!c })}
            />
            <span className="text-sm">Povinné</span>
          </label>
        </div>
        {field.type === "select" && (
          <div className="sm:col-span-2">
            <Label className="text-xs">Možnosti (řádek = jedna možnost)</Label>
            <Textarea
              value={(field.options || []).map((o) => `${o.value}:${o.label}`).join("\n")}
              onChange={(e) => {
                const lines = e.target.value.split("\n").filter(Boolean);
                const options = lines.map((line) => {
                  const [value, label] = line.includes(":") ? line.split(":") : [line.trim(), line.trim()];
                  return { value: (value || "").trim(), label: (label || value || "").trim() };
                });
                update({ options });
              }}
              placeholder="hodnota: Zobrazený text"
              rows={3}
              className="mt-1 bg-white border-slate-200 font-mono text-sm"
            />
          </div>
        )}
        {(field.type === "short_text" || field.type === "long_text" || field.type === "measurement" || field.type === "number") && (
          <div className="sm:col-span-2">
            <Label className="text-xs">Placeholder (volitelné)</Label>
            <Input
              value={field.placeholder || ""}
              onChange={(e) => update({ placeholder: e.target.value })}
              className="mt-1 bg-white border-slate-200"
            />
          </div>
        )}
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} className="text-slate-800 hover:text-destructive shrink-0">
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}
