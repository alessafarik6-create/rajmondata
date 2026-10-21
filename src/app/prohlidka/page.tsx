import type { Metadata } from "next";
import { ProductDemoPage } from "@/components/ai-tutor/product-demo-page";
import { ProductTourDemoProvider } from "@/contexts/product-tour-demo-context";

export const metadata: Metadata = {
  title: "AI prohlídka RAJMONDATA — interaktivní demo",
  description: "Hlasová a textová AI prohlídka firemního portálu RAJMONDATA bez registrace.",
  robots: { index: true, follow: true },
};

export default function ProhlidkaPage() {
  return (
    <ProductTourDemoProvider>
      <ProductDemoPage />
    </ProductTourDemoProvider>
  );
}
