import { describe, it, expect } from "vitest";
import { compareTaskKeys, safeRedirectPath, slugify } from "@/lib/utils";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("safeRedirectPath", () => {
  it("aceita caminhos internos", () => {
    expect(safeRedirectPath("/w/abc/p/app/backlog")).toBe("/w/abc/p/app/backlog");
    expect(safeRedirectPath("/auth/update-password")).toBe("/auth/update-password");
  });

  it("bloqueia open redirect", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
  });

  it("bloqueia variantes que o navegador normaliza para outra origem", () => {
    expect(safeRedirectPath("/\t/evil.com")).toBe("/");
    expect(safeRedirectPath("/\n/evil.com")).toBe("/");
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("/ /evil.com")).toBe("/");
    expect(safeRedirectPath("/.//evil.com")).toBe("/");
    expect(safeRedirectPath("/a/..//evil.com")).toBe("/");
    expect(safeRedirectPath("/%2e//evil.com")).toBe("/");
    expect(safeRedirectPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });

  it("preserva query e hash de caminhos internos", () => {
    expect(safeRedirectPath("/w/x?next=1#a")).toBe("/w/x?next=1#a");
  });
});

describe("compareTaskKeys", () => {
  it("ordena numericamente (APP-2 antes de APP-10)", () => {
    expect(["APP-10", "APP-2", "APP-1"].sort(compareTaskKeys)).toEqual(["APP-1", "APP-2", "APP-10"]);
  });
});

describe("slugify", () => {
  it("remove acentos e caracteres especiais", () => {
    expect(slugify("Integração Ágil & Cia!")).toBe("integracao-agil-cia");
  });
});

describe("rateLimit", () => {
  it("bloqueia após o limite e libera depois da janela", () => {
    resetRateLimits();
    const t0 = 1_000_000;
    expect(rateLimit("k", 2, 1000, t0).ok).toBe(true);
    expect(rateLimit("k", 2, 1000, t0 + 1).ok).toBe(true);
    const blocked = rateLimit("k", 2, 1000, t0 + 2);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(rateLimit("k", 2, 1000, t0 + 1001).ok).toBe(true);
  });
});
