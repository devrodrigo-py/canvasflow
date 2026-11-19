# CanvasFlow AI

Aplicativo colaborativo que une **quadro espacial infinito** (React Flow), **documentação em blocos** (TipTap) e **backlog relacional vivo** (Lista + Kanban) sobre o mesmo PostgreSQL — com IA interna (BYOK) e servidor **MCP** para agentes externos como o Claude Code.

## Arquitetura (Regra de Ouro)

- **A fonte da verdade do backlog é o PostgreSQL** (status, prioridade, responsável, dependências, critérios de aceite).
- **O canvas é uma projeção espacial viva** sobre essas tarefas (além de post-its soltos, frames e rascunhos).
- **Dupla integração de IA sobre a mesma API:**
  - **IA Interna (BYOK):** chave configurada pelo time (Anthropic/OpenAI/Google) para agrupar post-its, quebrar épicos, redigir specs e diagnosticar o quadro.
  - **IA Externa (MCP):** servidor Streamable HTTP autenticado por PAT para agentes externos lerem tarefas, atualizarem status, criarem bugs/débitos e registrarem logs de execução em tempo real.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui · `@xyflow/react` v12 · elkjs · TipTap · Supabase (PostgreSQL 16 + Auth + RLS + Realtime) · Zod · Vercel AI SDK · `@modelcontextprotocol/sdk` · Vitest · Playwright

## Setup local

### 1. Pré-requisitos

- Node.js 20+
- pnpm (`corepack enable`)
- Supabase CLI (`npm i -g supabase`)
- Docker (para o Supabase local)

### 2. Instalar dependências

```bash
pnpm install
```

### 3. Configurar ambiente

```bash
cp .env.example .env.local
# Gerar chave de criptografia (AES-256-GCM):
openssl rand -hex 32   # use o resultado em APP_ENCRYPTION_KEY
```

As chaves locais do Supabase são obtidas com:

```bash
supabase start
# Copie de "API URL" e "anon/service_role keys" para o .env.local
```

### 4. Aplicar migrações

```bash
pnpm db:reset   # sobe o banco + aplica supabase/migrations/*.sql
```

A migração inicial cria todas as tabelas, enums, trigger de `task_key` (ex: `APP-1`), políticas RLS e o **bootstrap automático** (trigger em `auth.users` que cria workspace + projeto `APP` + canvas padrão com frame "Inbox da IA" e 2 post-its de boas-vindas para cada novo usuário).

### 5. Rodar o app

```bash
pnpm dev        # http://localhost:3000
```

Faça signup/login em `/login` — o workspace de exemplo é criado automaticamente.

## Comandos

| Comando | Descrição |
| :--- | :--- |
| `pnpm dev` | Servidor de desenvolvimento |
| `pnpm build` | Build de produção |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript strict (`tsc --noEmit`) |
| `pnpm test` | Testes unitários (Vitest) |
| `pnpm db:reset` | Reset do banco + migrações |
| `pnpm db:types` | Regenerar `src/types/database.ts` |

## Fluxo de uso

1. **Canvas** (`/w/{ws}/p/{proj}/canvas/{id}`): crie post-its (`N`), frames (`F`), blocos de doc (`D`); arraste, conecte nós, use o botão **Organizar** (auto-layout ELK) ou o comando de IA sobre nós selecionados.
2. **Promover post-it**: 1 clique converte em `TaskCardNode` oficial (cria a linha em `tasks` e preserva posição/conexões).
3. **TaskDrawer** (duplo clique no card): editor TipTap com 3 abas — Especificação, Execução de Agentes, Discussão & Histórico.
4. **Backlog** (`/backlog`): visões Lista/Kanban sincronizadas em tempo real; filtro "Aguardando Revisão da IA"; botão "Ver no Canvas".
5. **Multiplayer**: cursores ao vivo (Presence + Broadcast, throttle 50ms), Follow Mode pelos avatares na barra superior.

## IA Interna (BYOK)

Configure em **Settings → Chaves de IA** (`/w/{ws}/settings/ai`). A chave é criptografada com AES-256-GCM (`APP_ENCRYPTION_KEY`) e nunca retorna ao cliente. Endpoints:

| Rota | Ação |
| :--- | :--- |
| `POST /api/ai/decompose-epic` | Quebra épico/post-its selecionados em 3–8 subtarefas (com dependências `blocks`) |
| `POST /api/ai/cluster-notes` | Agrupa post-its em frames temáticos |
| `POST /api/ai/draft-spec` | Redige spec (Contexto/Escopo/Edge Cases) + critérios de aceite |
| `POST /api/ai/summarize-canvas` | Diagnóstico: gargalos, bloqueios antigos, dependências circulares |

## Conectar o Claude Code (MCP)

1. Vá em **Settings → Agentes MCP** (`/w/{ws}/settings/mcp`).
2. Gere um token PAT (`cf_pat_...`) — exibido **uma única vez**; apenas o hash SHA-256 é armazenado.
3. Copie o snippet exibido para o `.mcp.json` do seu repositório:

```json
{
  "mcpServers": {
    "canvasflow": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer cf_pat_SEU_TOKEN_AQUI"
      }
    }
  }
}
```

Ou via CLI: `claude mcp add --transport http canvasflow http://localhost:3000/api/mcp --header "Authorization: Bearer cf_pat_..."`

### Tools disponíveis

| Tool | Descrição |
| :--- | :--- |
| `list_projects` | Projetos acessíveis pelo token |
| `get_backlog_tasks` | Tarefas com filtros de status/prioridade/tipo |
| `get_task_context` | Spec completa, critérios, log de agentes, comentários e tarefas conectadas |
| `update_task_status` | Atualiza status + registra execução no `agent_execution_log` |
| `create_linked_task` | Cria tarefa + projeta card no canvas (auto-layout) + conecta ao pai |
| `append_agent_note` | Nota técnica (progresso/arquitetura/bloqueio/teste) sem alterar status |
| `get_canvas_overview` | Resumo de frames, status, bloqueadores e post-its não promovidos |

### Guardrails obrigatórios

1. **Human-in-the-loop:** sem `allow_direct_done`, `done` é redirecionado para `in_review` com aviso — aprovação humana é exigida (botão "Aprovar e Concluir" no TaskDrawer).
2. **Sem coordenadas manuais:** nenhuma tool aceita `(x, y)`; cards criados via MCP nascem com `needs_auto_layout = true` e o frontend os posiciona com elkjs ao lado do pai (ou no Inbox da IA).
3. **Spec humana preservada:** agentes escrevem apenas no `agent_execution_log`, nunca no `spec_json`.

## Segurança

- RLS em todas as tabelas; acesso a `ai_provider_keys`/`agent_tokens` restrito a owner/admin.
- MCP usa service role **somente após** validar o `token_hash` e sempre filtrado pelo `workspace_id` (e `project_id`, se definido no token).
- Segredos apenas em arquivos server-only (`import "server-only"`).

## Testes

```bash
pnpm test                                  # unitários: crypto, elkLayout, mcp-guardrails
npx playwright test tests/e2e/core-flow.spec.ts   # smoke E2E (ver variáveis no topo do arquivo)
```

O E2E cobre: login → criar post-it → promover para tarefa → editar spec → atualizar via MCP simulada → verificar atualização em tempo real no card e no backlog.
