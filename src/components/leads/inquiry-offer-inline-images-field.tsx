"use client";

import React, { useMemo } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isInquiryOfferInlineInEmail,
  type InquiryOfferAttachmentRef,
} from "@/lib/inquiry-offer-attachments";
import { listInlineImageRefs } from "@/lib/inquiry-offer-inline-images";

type Props = {
  attachments: InquiryOfferAttachmentRef[];
  onChange: (next: InquiryOfferAttachmentRef[]) => void;
  disabled?: boolean;
};

function previewUrl(ref: InquiryOfferAttachmentRef): string | null {
  const url = ref.downloadUrl?.trim();
  return url || null;
}

export function InquiryOfferInlineImagesField(props: Props) {
  const inlineRefs = useMemo(
    () => listInlineImageRefs(props.attachments),
    [props.attachments]
  );

  if (inlineRefs.length === 0) return null;

  const updateRef = (id: string, patch: Partial<InquiryOfferAttachmentRef>) => {
    props.onChange(
      props.attachments.map((a) => (a.id === id ? { ...a, ...patch } : a))
    );
  };

  const removeInline = (id: string) => {
    props.onChange(props.attachments.filter((a) => a.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    const ordered = listInlineImageRefs(props.attachments);
    const idx = ordered.findIndex((a) => a.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return;
    const a = ordered[idx];
    const b = ordered[swapIdx];
    const orderA = a.inlineOrder ?? idx;
    const orderB = b.inlineOrder ?? swapIdx;
    props.onChange(
      props.attachments.map((item) => {
        if (item.id === a.id) return { ...item, inlineOrder: orderB };
        if (item.id === b.id) return { ...item, inlineOrder: orderA };
        return item;
      })
    );
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Fotografie v e-mailu</Label>
      <p className="text-xs text-muted-foreground">
        Zobrazí se pod textem nabídky, před firemním podpisem. Pořadí lze změnit šipkami.
      </p>
      <ul className="space-y-3 rounded-md border border-slate-200 bg-slate-50/80 p-2">
        {inlineRefs.map((a, index) => {
          const thumb = previewUrl(a);
          return (
            <li
              key={a.id}
              className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-2 sm:flex-row sm:items-start"
            >
              <div className="flex shrink-0 items-center gap-2 sm:flex-col">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt=""
                    className="h-20 w-20 rounded-md border border-slate-200 object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-[10px] text-slate-500">
                    Náhled
                  </div>
                )}
                <div className="flex gap-0.5 sm:flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={props.disabled || index === 0}
                    onClick={() => move(a.id, -1)}
                    aria-label="Posunout nahoru"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={props.disabled || index === inlineRefs.length - 1}
                    onClick={() => move(a.id, 1)}
                    aria-label="Posunout dolů"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="truncate text-xs font-medium text-slate-800">{a.filename}</p>
                <Input
                  className="h-9 text-sm"
                  placeholder="Popisek (volitelně)"
                  value={a.inlineCaption ?? ""}
                  disabled={props.disabled}
                  onChange={(e) => updateRef(a.id, { inlineCaption: e.target.value || null })}
                />
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                  <Checkbox
                    checked={a.alsoAsAttachment === true}
                    disabled={props.disabled}
                    onCheckedChange={(v) =>
                      updateRef(a.id, { alsoAsAttachment: v === true })
                    }
                  />
                  Také jako samostatná příloha ke stažení
                </label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 self-start"
                disabled={props.disabled}
                onClick={() => removeInline(a.id)}
                aria-label="Odebrat z e-mailu"
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Obrázky bez inline zobrazení — volba „jen příloha“. */
export function countInlineImages(attachments: InquiryOfferAttachmentRef[]): number {
  return attachments.filter(isInquiryOfferInlineInEmail).length;
}
