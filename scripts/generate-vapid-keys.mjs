#!/usr/bin/env node
/**
 * Vygeneruje VAPID klíče pro Web Push.
 * Použití: node scripts/generate-vapid-keys.mjs
 *
 * Na Vercel nastavte:
 *   VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY  (NIKDY NEXT_PUBLIC)
 *   VAPID_SUBJECT=mailto:vas@email.cz
 *
 * Pro klienta stačí VAPID_PUBLIC_KEY — načítá se přes /api/notifications/vapid-public
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("VAPID_SUBJECT=mailto:notify@example.com");
