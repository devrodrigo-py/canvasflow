import { describe, it, expect } from "vitest";
import { htmlToMarkdown, markdownToHtml, isEmptySpecJson, EMPTY_SPEC_JSON } from "@/lib/spec-format";

describe("spec-format", () => {
  it("converte HTML do editor em Markdown real", () => {
    const md = htmlToMarkdown(
      '<h2>Contexto</h2><p>Texto <strong>forte</strong></p><ul><li><p>item</p></li></ul><pre><code class="language-ts">const a = 1;</code></pre>'
    );
    expect(md).toContain("## Contexto");
    expect(md).toContain("**forte**");
    expect(md).toContain("- item");
    expect(md).toContain("```ts\nconst a = 1;\n```");
  });

  it("converte checklists do TipTap", () => {
    const md = htmlToMarkdown(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>feito</p></li><li data-type="taskItem" data-checked="false"><p>pendente</p></li></ul>'
    );
    expect(md).toContain("- [x] feito");
    expect(md).toContain("- [ ] pendente");
  });

  it("renderiza Markdown vindo da IA/agentes como HTML", () => {
    const html = markdownToHtml("## Escopo\n\n- a\n- b");
    expect(html).toContain("<h2>Escopo</h2>");
    expect(html).toContain("<li>a</li>");
  });

  it("detecta documento vazio", () => {
    expect(isEmptySpecJson(EMPTY_SPEC_JSON)).toBe(true);
    expect(isEmptySpecJson(null)).toBe(true);
    expect(
      isEmptySpecJson({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] })
    ).toBe(false);
  });

  it("editor vazio vira string vazia", () => {
    expect(htmlToMarkdown("<p></p>")).toBe("");
  });
});
