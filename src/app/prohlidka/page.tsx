import type { Metadata } from "next";
import { ProductDemoPage } from "@/components/ai-tutor/product-demo-page";

export const metadata: Metadata = {
  title: "AI prohlídka RAJMONDATA — 2 minuty",
  description: "Interaktivní ukázka firemního portálu RAJMONDATA bez registrace.",
  robots: { index: true, follow: true },
};

export default function ProhlidkaPage() {
  return <ProductDemoPage />;
}
