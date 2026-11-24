import { marked } from "marked";
import TurndownService from "turndown";

/**
 * Formato da spec (decisão única):
 *  - spec_json     → documento TipTap, formato canônico do editor humano
 *  - spec_markdown → Markdown DERIVADO do editor (lido por agentes MCP e pela IA)
 *
 * Quando IA/agentes escrevem spec_markdown diretamente, gravam spec_json vazio;
 * o editor então renderiza a partir do Markdown e, ao salvar, regrava os dois.
 */
export const EMPTY_SPEC_JSON = { type: "doc", content: [{ type: "paragraph" }] } as const;

export function isEmptySpecJson(json: unknown): boolean {
  if (!json || typeof json !== "object") return true;
  const content = (json as { content?: unknown[] }).content;
  if (!Array.isArray(content) || content.length === 0) return true;
  return content.every((node) => {
    const n = node as { type?: string; content?: unknown[] };
    return n.type === "paragraph" && (!n.content || n.content.length === 0);
  });
}

/** Markdown → HTML para carregar no TipTap (o schema do ProseMirror descarta tags desconhecidas). */
export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  return marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string;
}

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndown) return turndown;
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
  });

  // Checklists do TipTap: <li data-type="taskItem" data-checked="true">
  service.addRule("taskItem", {
    filter: (node) => node.nodeName === "LI" && (node as HTMLElement).getAttribute("data-type") === "taskItem",
    replacement: (content, node) => {
      const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
      return `- [${checked ? "x" : " "}] ${content.replace(/^\s+|\s+$/g, "").replace(/\n+/g, " ")}\n`;
    },
  });

  // Blocos de código com linguagem (lowlight usa class="language-ts")
  service.addRule("fencedCodeWithLanguage", {
    filter: (node) => node.nodeName === "PRE" && node.firstChild?.nodeName === "CODE",
    replacement: (_content, node) => {
      const code = node.firstChild as HTMLElement;
      const lang = (code.getAttribute("class") ?? "").replace(/^language-/, "");
      return `\n\`\`\`${lang}\n${code.textContent ?? ""}\n\`\`\`\n`;
    },
  });

  turndown = service;
  return service;
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim() || html === "<p></p>") return "";
  return (
    getTurndown()
      .turndown(html)
      // Turndown alinha itens com 3 espaços ("-   item"); normaliza para o estilo comum
      .replace(/^(\s*)(-|\d+\.)\s{2,}/gm, "$1$2 ")
      .trim()
  );
}
