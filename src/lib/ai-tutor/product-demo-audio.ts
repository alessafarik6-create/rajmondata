import { buildDetailedDemoSteps } from "@/lib/ai-tutor/product-demo-detailed";
import { quickDemoSteps } from "@/lib/ai-tutor/product-demo-script";

/** Veřejné MP3 — statický soubor nebo generování přes API (Edge TTS). */
export function productTourAudioUrl(stepId: string): string {
  return `/api/public/product-tour/audio/${encodeURIComponent(stepId)}`;
}

/** Všechny unikátní kroky pro generování MP3 a manifest. */
export function listProductTourAudioItems(): { id: string; narration: string }[] {
  const steps = [...quickDemoSteps("full"), ...buildDetailedDemoSteps()];
  const map = new Map<string, string>();
  for (const s of steps) {
    if (s.narration?.trim()) map.set(s.id, s.narration.trim());
  }
  return [...map.entries()].map(([id, narration]) => ({ id, narration }));
}

export type ProductTourAudioManifest = {
  v: 1;
  voice: string;
  steps: string[];
};
