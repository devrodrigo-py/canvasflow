import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM

function getEncryptionKey(): Buffer {
  const hexKey = process.env.APP_ENCRYPTION_KEY;
  if (!hexKey) {
    throw new Error("APP_ENCRYPTION_KEY environment variable is not set");
  }
  if (hexKey.length !== 64) {
    throw new Error("APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(hexKey, "hex");
}

/**
 * Encrypts a plaintext string using AES-256-GCM
 * Returns an object with encrypted data, IV, and auth tag (all as hex strings)
 */
export function encrypt(plaintext: string): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypts data encrypted with encrypt()
 */
export function decrypt(
  encryptedHex: string,
  ivHex: string,
  authTagHex: string
): string {
  const key = getEncryptionKey();
  const encrypted = Buffer.from(encryptedHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Creates a SHA-256 hash of the input string
 * Returns hex string
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Generates a secure random token prefix for display
 */
export function generateTokenPrefix(): string {
  const bytes = randomBytes(4);
  return `cf_pat_${bytes.toString("hex")}`;
}

/**
 * Generates a secure random token
 */
export function generateToken(): string {
  const bytes = randomBytes(32);
  return `cf_pat_${bytes.toString("hex")}`;
}

/**
 * Creates a preview of an API key for display (shows first 8 and last 4 chars)
 */
export function createKeyPreview(apiKey: string): string {
  if (apiKey.length <= 12) {
    return "*".repeat(apiKey.length);
  }
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}