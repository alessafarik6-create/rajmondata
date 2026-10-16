"use client";

import React, { useMemo } from "react";
import { CatalogPdfAttachmentsSection } from "@/components/catalogs/catalog-pdf-attachments-section";
import type { ProductCatalogPdfAttachment } from "@/lib/product-catalogs";
import { customerVisiblePdfAttachments } from "@/lib/product-catalogs";

type Props = {
  companyId: string;
  catalogId: string;
  productId?: string;
  attachments: ProductCatalogPdfAttachment[] | undefined | null;
};

/** PDF dokumenty pro zákazníka — pouze s příznakem customerVisible. */
export function CustomerCatalogPdfSection({
  companyId,
  catalogId,
  productId,
  attachments,
}: Props) {
  const visible = useMemo(() => customerVisiblePdfAttachments(attachments), [attachments]);
  if (!visible.length) return null;
  return (
    <CatalogPdfAttachmentsSection
      companyId={companyId}
      catalogId={catalogId}
      productId={productId}
      attachments={visible}
      canWrite={false}
      customerMode
    />
  );
}
