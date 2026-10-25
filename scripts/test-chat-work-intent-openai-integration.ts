/**
 * Integrační test: skutečné volání OpenAI s obrázkem.
 * Spuštění: OPENAI_API_KEY=... npx tsx scripts/test-chat-work-intent-openai-integration.ts
 * Volitelně: CHAT_WORK_INTENT_TEST_IMAGE=c:/path/to/screenshot.png
 */

import fs from "node:fs";
import { analyzeChatWorkIntentWithOpenAi } from "@/lib/chat/openai-chat-work-intent-client";

async function main() {
  const key = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!key) {
    console.error("Chybí OPENAI_API_KEY — integrační test přeskočen.");
    process.exit(0);
  }
  const imagePath =
    process.env.CHAT_WORK_INTENT_TEST_IMAGE ??
    process.argv[2] ??
    "";
  if (!imagePath || !fs.existsSync(imagePath)) {
    console.error(
      "Nastavte CHAT_WORK_INTENT_TEST_IMAGE nebo předajte cestu k screenshotu jako argument."
    );
    process.exit(1);
  }
  const buf = fs.readFileSync(imagePath);
  const res = await analyzeChatWorkIntentWithOpenAi({
    messageText: "Rezervace v prosinci",
    referenceDateIso: new Date("2026-10-25").toISOString(),
    timeZone: "Europe/Prague",
    media: [{ kind: "image", mimeType: "image/png", base64: buf.toString("base64") }],
    imageTilesSent: 1,
  });
  const parsed = JSON.parse(res.outputText) as {
    detectedItems?: unknown[];
    proposals?: unknown[];
    extractedTextPreview?: string;
  };
  const count = Math.max(
    parsed.detectedItems?.length ?? 0,
    parsed.proposals?.length ?? 0
  );
  console.log("model:", res.model);
  console.log("detectedItems:", parsed.detectedItems?.length ?? 0);
  console.log("proposals:", parsed.proposals?.length ?? 0);
  console.log("extractedTextPreview length:", (parsed.extractedTextPreview ?? "").length);
  if (count < 5) {
    console.error("Očekáváno alespoň 5 položek pro testovací screenshot rezervací.");
    process.exit(1);
  }
  console.log("Integrační test OK.");
}

void main();
