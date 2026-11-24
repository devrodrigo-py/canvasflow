import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits para GCM
const HEX_KEY = /^[0-9a-fA-F]{64}$/;

/**
 * Chaves versionadas para permitir rotação:
 *  - APP_ENCRYPTION_KEY          → chave atual
 *  - APP_ENCRYPTION_KEY_VERSION  → versão da chave atual (padrão 1)
 *  - APP_ENCRYPTION_KEY_V{n}     → chaves antigas, apenas para decifrar
 */
export function currentKeyVersion(): number {
  const raw = process.env.APP_ENCRYPTION_KEY_VERSION;
  const version = raw ? Number(raw) : 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("APP_ENCRYPTION_KEY_VERSION deve ser um inteiro >= 1");
  }
  return version;
}

function validateKey(hexKey: string | undefined, name: string): Buffer {
  if (!hexKey) throw new Error(`${name} não está definida`);
  if (!HEX_KEY.test(hexKey)) throw new Error(`${name} deve ter 64 caracteres hexadecimais (32 bytes)`);
  if (/^(.)\1+$/.test(hexKey)) {
    // Ex.: a chave de exemplo toda em zeros do .env.example
    throw new Error(`${name} é uma chave trivial; gere uma com: openssl rand -hex 32`);
  }
  return Buffer.from(hexKey, "hex");
}

function getEncryptionKey(version: number): Buffer {
  if (version === currentKeyVersion()) {
    return validateKey(process.env.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  }
  const name = `APP_ENCRYPTION_KEY_V${version}`;
  return validateKey(process.env[name], name);
}

export interface EncryptedPayload {
  encrypted: string;
  iv: string;
  authTag: string;
  version: number;
}

/** Cifra com AES-256-GCM usando a chave atual. */
export function encrypt(plaintext: string): EncryptedPayload {
  const version = currentKeyVersion();
  const key = getEncryptionKey(version);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    encrypted: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    version,
  };
}

/** Decifra dados de encrypt(); `version` seleciona a chave usada na cifragem. */
export function decrypt(encryptedHex: string, ivHex: string, authTagHex: string, version = 1): string {
  const key = getEncryptionKey(version);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Token PAT para agentes MCP (256 bits de entropia). */
export function generateToken(): string {
  return `cf_pat_${randomBytes(32).toString("hex")}`;
}

/** Token de convite de workspace (256 bits, URL-safe). */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Prévia de chave para exibição (8 primeiros + 4 últimos caracteres). */
export function createKeyPreview(apiKey: string): string {
  if (apiKey.length <= 12) return "*".repeat(apiKey.length);
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}
