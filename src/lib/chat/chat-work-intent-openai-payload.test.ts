import assert from "node:assert/strict";
import { buildChatWorkIntentOpenAiContentParts } from "@/lib/chat/openai-chat-work-intent-client";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("buildChatWorkIntentOpenAiContentParts includes input_image with base64", () => {
  const parts = buildChatWorkIntentOpenAiContentParts({
    messageText: "test",
    referenceDateIso: new Date().toISOString(),
    timeZone: "Europe/Prague",
    media: [{ kind: "image", mimeType: "image/jpeg", base64: "abc123" }],
    imageTilesSent: 1,
  });
  const images = parts.filter((p) => p.type === "input_image");
  assert.equal(images.length, 1);
  const url = String((images[0] as { image_url?: string }).image_url ?? "");
  assert.ok(url.startsWith("data:image/jpeg;base64,abc123"));
});
