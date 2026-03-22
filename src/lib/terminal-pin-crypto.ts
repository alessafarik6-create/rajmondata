/**
 * Hashování PINu terminálu — pouze na serveru (API routes).
 */
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashTerminalPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verifyTerminalPinHash(
  pin: string,
  hash: string
): Promise<boolean> {
  if (!hash || typeof hash !== "string") return false;
  return bcrypt.compare(pin, hash);
}
