/**
 * Vygeneruje MP3 pro veřejnou prohlídku (Edge TTS, český hlas).
 * Spuštění: npx tsx scripts/generate-product-tour-audio.ts
 */
import https from "node:https";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "edge-tts-node";
import { listProductTourAudioItems } from "../src/lib/ai-tutor/product-demo-audio";

const VOICE = "cs-CZ-VlastaNeural";
const OUT_DIR = join(process.cwd(), "public", "product-tour", "audio");
const HTTPS_AGENT = new https.Agent({ keepAlive: true });

async function synthesizeToFile(text: string, outPath: string) {
  const tts = new MsEdgeTTS({ agent: HTTPS_AGENT });
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  await tts.toFile(outPath, text);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const items = listProductTourAudioItems();
  const generated: string[] = [];

  for (const { id, narration } of items) {
    const outPath = join(OUT_DIR, `${id}.mp3`);
    process.stdout.write(`Generating ${id}… `);
    try {
      await synthesizeToFile(narration, outPath);
      generated.push(id);
      console.log("OK");
    } catch (e) {
      console.log("FAIL", e instanceof Error ? e.message : e);
    }
  }

  const manifest = { v: 1 as const, voice: VOICE, steps: generated.sort() };
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Done: ${generated.length}/${items.length} files → ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
