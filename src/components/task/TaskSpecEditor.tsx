"use client";

import * as React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Link from "@tiptap/extension-link";
import { common, createLowlight } from "lowlight";
import { cn } from "@/lib/utils";
import { htmlToMarkdown, isEmptySpecJson, markdownToHtml } from "@/lib/spec-format";

const lowlight = createLowlight(common);

// Toolbar button component
interface ToolbarButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title?: string;
}

function ToolbarButton({
  children,
  onClick,
  isActive,
  disabled,
  title,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center justify-center w-8 h-8 rounded text-sm font-medium transition-colors",
        "hover:bg-muted",
        isActive && "bg-primary text-primary-foreground",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

export interface SpecChange {
  spec_json: Record<string, unknown>;
  spec_markdown: string;
}

interface TaskSpecEditorProps {
  /** Documento TipTap (canônico). Vazio → o editor carrega a partir do Markdown. */
  specJson: unknown;
  /** Markdown derivado (ou escrito pela IA/agentes). */
  specMarkdown: string;
  onChange: (change: SpecChange) => void | Promise<void>;
  editable?: boolean;
  placeholder?: string;
  /** Atraso do salvamento automático (evita uma escrita por tecla). */
  debounceMs?: number;
}

function initialContent(specJson: unknown, specMarkdown: string) {
  return isEmptySpecJson(specJson) ? markdownToHtml(specMarkdown) : (specJson as Record<string, unknown>);
}

export function TaskSpecEditor({
  specJson,
  specMarkdown,
  onChange,
  editable = true,
  placeholder = "Escreva a especificação da tarefa...",
  debounceMs = 800,
}: TaskSpecEditorProps) {
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = React.useRef<SpecChange | null>(null);
  // Último markdown que este editor emitiu: distingue eco do próprio save de mudança externa
  const lastEmittedMarkdown = React.useRef<string>(specMarkdown);

  const flush = React.useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const change = pending.current;
    pending.current = null;
    if (change) void onChangeRef.current(change);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Placeholder.configure({
        placeholder,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      // Sem a extensão de link, specs em Markdown perdiam as URLs ao serem salvas
      Link.configure({
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
    ],
    content: initialContent(specJson, specMarkdown),
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const markdown = htmlToMarkdown(editor.getHTML());
      lastEmittedMarkdown.current = markdown;
      pending.current = { spec_json: editor.getJSON() as Record<string, unknown>, spec_markdown: markdown };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, debounceMs);
    },
    onBlur: () => flush(),
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[300px] p-4",
      },
    },
  });

  // Salva o que estiver pendente ao fechar o drawer / trocar de tarefa
  React.useEffect(() => flush, [flush]);

  // Mudanças externas (IA gerou spec, outro usuário editou) atualizam o editor
  React.useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (specMarkdown === lastEmittedMarkdown.current) return;
    lastEmittedMarkdown.current = specMarkdown;
    editor.commands.setContent(initialContent(specJson, specMarkdown), false);
  }, [editor, specJson, specMarkdown]);

  React.useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) {
    return (
      <div className="border border-border rounded-lg p-4 min-h-[300px] bg-muted/30">
        <p className="text-muted-foreground text-center py-8">Carregando editor...</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-background">
      {/* Toolbar */}
      {editable && (
        <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border bg-muted/30">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            isActive={editor.isActive("heading", { level: 1 })}
            title="Título 1 (Ctrl+Alt+1)"
          >
            H1
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor.isActive("heading", { level: 2 })}
            title="Título 2 (Ctrl+Alt+2)"
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            isActive={editor.isActive("heading", { level: 3 })}
            title="Título 3 (Ctrl+Alt+3)"
          >
            H3
          </ToolbarButton>

          <div className="w-px h-6 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive("bold")}
            title="Negrito (Ctrl+B)"
          >
            <strong>B</strong>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive("italic")}
            title="Itálico (Ctrl+I)"
          >
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive("strike")}
            title="Tachado"
          >
            <span style={{ textDecoration: "line-through" }}>S</span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            isActive={editor.isActive("code")}
            title="Código inline"
          >
            <code>{}</code>
          </ToolbarButton>

          <div className="w-px h-6 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive("bulletList")}
            title="Lista com marcadores"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive("orderedList")}
            title="Lista numerada"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            isActive={editor.isActive("taskList")}
            title="Lista de tarefas"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="20" rx="2" />
              <path d="M8 12l2 2 4-4" />
            </svg>
          </ToolbarButton>

          <div className="w-px h-6 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            isActive={editor.isActive("codeBlock")}
            title="Bloco de código"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 18 2 12 8 6" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setBlockquote().run()}
            isActive={editor.isActive("blockquote")}
            title="Citação"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h1" />
            </svg>
          </ToolbarButton>

          <div className="flex-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            isActive={false}
            disabled={!editor.can().undo()}
            title="Desfazer (Ctrl+Z)"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            isActive={false}
            disabled={!editor.can().redo()}
            title="Refazer (Ctrl+Shift+Z)"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
            </svg>
          </ToolbarButton>
        </div>
      )}

      {/* Editor Content */}
      <EditorContent editor={editor} className="min-h-[300px]" />
    </div>
  );
}