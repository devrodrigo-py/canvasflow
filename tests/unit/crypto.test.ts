import { describe, it, expect, beforeAll, vi } from "vitest";
import { encrypt, decrypt, sha256, generateTokenPrefix, generateToken, createKeyPreview } from "@/lib/crypto";

// Mock environment variable before importing crypto
const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

vi.stubEnv("APP_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);

describe("crypto", () => {
  describe("encrypt/decrypt", () => {
    it("should encrypt and decrypt a simple string", () => {
      const plaintext = "test-api-key-12345";
      const { encrypted, iv, authTag } = encrypt(plaintext);
      const decrypted = decrypt(encrypted, iv, authTag);
      expect(decrypted).toBe(plaintext);
    });

    it("should encrypt and decrypt a long string", () => {
      const plaintext = "x".repeat(1000);
      const { encrypted, iv, authTag } = encrypt(plaintext);
      const decrypted = decrypt(encrypted, iv, authTag);
      expect(decrypted).toBe(plaintext);
    });

    it("should encrypt and decrypt special characters", () => {
      const plaintext = "sk-ant-!@#$%^&*()_+{}|:<>?~`-=[]\\;\',./";
      const { encrypted, iv, authTag } = encrypt(plaintext);
      const decrypted = decrypt(encrypted, iv, authTag);
      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertext for same plaintext (random IV)", () => {
      const plaintext = "same-input";
      const result1 = encrypt(plaintext);
      const result2 = encrypt(plaintext);
      expect(result1.encrypted).not.toBe(result2.encrypted);
      expect(result1.iv).not.toBe(result2.iv);
      expect(result1.authTag).not.toBe(result2.authTag);

      // But both should decrypt to the same plaintext
      expect(decrypt(result1.encrypted, result1.iv, result1.authTag)).toBe(plaintext);
      expect(decrypt(result2.encrypted, result2.iv, result2.authTag)).toBe(plaintext);
    });

    it("should fail to decrypt with wrong auth tag", () => {
      const plaintext = "test";
      const { encrypted, iv, authTag } = encrypt(plaintext);
      const wrongAuthTag = "0".repeat(32); // 16 bytes = 32 hex chars

      expect(() => decrypt(encrypted, iv, wrongAuthTag)).toThrow();
    });

    it("should fail to decrypt with wrong IV", () => {
      const plaintext = "test";
      const { encrypted, authTag } = encrypt(plaintext);
      const wrongIv = "0".repeat(24); // 12 bytes = 24 hex chars

      expect(() => decrypt(encrypted, wrongIv, authTag)).toThrow();
    });

    it("should fail to decrypt with corrupted ciphertext", () => {
      const plaintext = "test";
      const { encrypted, iv, authTag } = encrypt(plaintext);
      const corrupted = encrypted.slice(0, -2) + "ff";

      expect(() => decrypt(corrupted, iv, authTag)).toThrow();
    });
  });

  describe("sha256", () => {
    it("should produce consistent hash for same input", () => {
      const input = "test-token";
      const hash1 = sha256(input);
      const hash2 = sha256(input);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // 256 bits = 64 hex chars
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = sha256("input-1");
      const hash2 = sha256("input-2");
      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty string", () => {
      const hash = sha256("");
      expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });
  });

  describe("generateTokenPrefix", () => {
    it("should generate prefix with correct format", () => {
      const prefix = generateTokenPrefix();
      expect(prefix).toMatch(/^cf_pat_[0-9a-f]{8}$/);
    });

    it("should generate different prefixes", () => {
      const prefix1 = generateTokenPrefix();
      const prefix2 = generateTokenPrefix();
      expect(prefix1).not.toBe(prefix2);
    });
  });

  describe("generateToken", () => {
    it("should generate token with correct format", () => {
      const token = generateToken();
      expect(token).toMatch(/^cf_pat_[0-9a-f]{64}$/);
    });

    it("should generate different tokens", () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe("createKeyPreview", () => {
    it("should create preview for long keys", () => {
      const key = "sk-ant-api0123456789abcdef";
      const preview = createKeyPreview(key);
      expect(preview).toBe("sk-ant-a...cdef");
    });

    it("should mask short keys", () => {
      const key = "short";
      const preview = createKeyPreview(key);
      expect(preview).toBe("*****");
    });

    it("should handle exactly 12 char keys", () => {
      const key = "123456789012";
      const preview = createKeyPreview(key);
      expect(preview).toBe("************");
    });
  });
});