-- Extensões
create extension if not exists "pgcrypto";

-- Enums
create type workspace_role as enum ('owner', 'admin', 'member', 'viewer');
create type task_status as enum ('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done');
create type task_priority as enum ('low', 'medium', 'high', 'urgent');
create type task_type as enum ('epic', 'feature', 'task', 'bug', 'tech_debt');
create type canvas_node_type as enum ('task_card', 'sticky_note', 'frame', 'doc_block');
create type canvas_edge_type as enum ('blocks', 'parent_of', 'relates_to', 'derived_from');
create type actor_type as enum ('human', 'internal_ai', 'external_agent');
create type ai_provider as enum ('anthropic', 'openai', 'google');

-- 1. Workspaces e Membros
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- 2. Projetos e Canvases
create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  key_prefix text not null check (key_prefix ~ '^[A-Z]{2,6}$'),
  task_counter integer not null default 0,
  description text,
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table canvases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  viewport jsonb not null default '{"x": 0, "y": 0, "zoom": 1}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Backlog Oficial (Fonte da Verdade)
create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  task_key text not null,
  title text not null,
  status task_status not null default 'backlog',
  priority task_priority not null default 'medium',
  type task_type not null default 'task',
  sprint text,
  estimate_points integer,
  assignee_id uuid references auth.users(id) on delete set null,
  parent_task_id uuid references tasks(id) on delete set null,
  spec_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  spec_markdown text not null default '',
  acceptance_criteria jsonb not null default '[]'::jsonb,
  agent_execution_log jsonb not null default '[]'::jsonb,
  last_updated_by_type actor_type not null default 'human',
  last_updated_by_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, task_key)
);

-- Função para gerar task_key sequencial por projeto (ex: DEV-1, DEV-2)
create or replace function generate_task_key()
returns trigger as $$
declare
  v_prefix text;
  v_counter integer;
begin
  update projects
  set task_counter = task_counter + 1
  where id = new.project_id
  returning key_prefix, task_counter into v_prefix, v_counter;

  new.task_key := v_prefix || '-' || v_counter;
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger trg_tasks_generate_key
before insert on tasks
for each row
when (new.task_key is null or new.task_key = '')
execute function generate_task_key();

-- 4. Projeção Espacial do Canvas (Nós e Arestas)
create table canvas_nodes (
  id uuid primary key default gen_random_uuid(),
  canvas_id uuid not null references canvases(id) on delete cascade,
  node_type canvas_node_type not null,
  task_id uuid references tasks(id) on delete cascade,
  parent_frame_id uuid references canvas_nodes(id) on delete set null,
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  width double precision,
  height double precision,
  z_index integer not null default 0,
  needs_auto_layout boolean not null default false,
  data jsonb not null default '{}'::jsonb, -- cor do post-it, texto livre, título do frame, etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_canvas_nodes_canvas on canvas_nodes(canvas_id);
create index idx_canvas_nodes_task on canvas_nodes(task_id);

create table canvas_edges (
  id uuid primary key default gen_random_uuid(),
  canvas_id uuid not null references canvases(id) on delete cascade,
  source_node_id uuid not null references canvas_nodes(id) on delete cascade,
  target_node_id uuid not null references canvas_nodes(id) on delete cascade,
  edge_type canvas_edge_type not null default 'relates_to',
  label text,
  created_at timestamptz not null default now(),
  unique (canvas_id, source_node_id, target_node_id, edge_type)
);

-- 5. Comentários (Suporta threads em tarefas e pinos no canvas)
create table comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  canvas_id uuid references canvases(id) on delete cascade,
  pin_x double precision,
  pin_y double precision,
  parent_comment_id uuid references comments(id) on delete cascade,
  actor_type actor_type not null default 'human',
  author_user_id uuid references auth.users(id) on delete set null,
  author_label text not null,
  body_markdown text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- 6. Chaves BYOK de IA Interna (Criptografadas com AES-256-GCM)
create table ai_provider_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider ai_provider not null,
  default_model text not null,
  encrypted_api_key text not null,
  key_iv text not null,
  key_auth_tag text not null,
  key_preview text not null, -- ex: "sk-ant-...8f2a"
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

-- 7. Tokens MCP para Agentes Externos (Claude Code, Desktop, Cursor)
create table agent_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade, -- null = acesso a todos projetos do workspace
  name text not null,                                        -- ex: "Claude Code - MacBook"
  actor_label text not null default 'Claude Agent',
  token_hash text not null unique,                           -- SHA-256 do token
  token_prefix text not null,                                -- ex: "cf_pat_9a2b"
  scopes text[] not null default array['tasks:read', 'tasks:write', 'canvas:write'],
  allow_direct_done boolean not null default false,          -- Guardrail: por padrão só pode mover até in_review
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- 8. Log de Auditoria Unificado
create table activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  actor_type actor_type not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_label text not null,
  action text not null, -- ex: 'task.created', 'task.status_changed', 'node.promoted', 'agent.note_appended'
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Habilitar Realtime nas tabelas críticas
alter publication supabase_realtime add table tasks, canvas_nodes, canvas_edges, comments, activity_logs;

-- RLS Policies
-- Helper function
create or replace function is_workspace_member(ws_id uuid)
returns boolean as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$ language sql security definer stable set search_path = public;

create or replace function is_workspace_owner_or_admin(ws_id uuid)
returns boolean as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$ language sql security definer stable set search_path = public;

-- Workspaces
alter table workspaces enable row level security;
create policy "Members can view workspace" on workspaces
  for select using (is_workspace_member(id));
create policy "Members can update workspace" on workspaces
  for update using (is_workspace_owner_or_admin(id));

-- Workspace Members
alter table workspace_members enable row level security;
create policy "Members can view workspace members" on workspace_members
  for select using (is_workspace_member(workspace_id));
create policy "Owners/Admins can manage members" on workspace_members
  for all using (is_workspace_owner_or_admin(workspace_id));

-- Projects
alter table projects enable row level security;
create policy "Members can view projects" on projects
  for select using (is_workspace_member(workspace_id));
create policy "Members can create projects" on projects
  for insert with check (is_workspace_member(workspace_id));
create policy "Owners/Admins can update projects" on projects
  for update using (is_workspace_owner_or_admin(workspace_id));
create policy "Owners/Admins can delete projects" on projects
  for delete using (is_workspace_owner_or_admin(workspace_id));

-- Canvases
alter table canvases enable row level security;
create policy "Members can view canvases" on canvases
  for select using (
    exists (
      select 1 from projects p
      where p.id = canvases.project_id and is_workspace_member(p.workspace_id)
    )
  );
create policy "Members can create canvases" on canvases
  for insert with check (
    exists (
      select 1 from projects p
      where p.id = canvases.project_id and is_workspace_member(p.workspace_id)
    )
  );
create policy "Members can update canvases" on canvases
  for update using (
    exists (
      select 1 from projects p
      where p.id = canvases.project_id and is_workspace_member(p.workspace_id)
    )
  );
create policy "Owners/Admins can delete canvases" on canvases
  for delete using (
    exists (
      select 1 from projects p
      where p.id = canvases.project_id and is_workspace_owner_or_admin(p.workspace_id)
    )
  );

-- Tasks
alter table tasks enable row level security;
create policy "Members can view tasks" on tasks
  for select using (
    exists (
      select 1 from projects p
      where p.id = tasks.project_id and is_workspace_member(p.workspace_id)
    )
  );
create policy "Members can create tasks" on tasks
  for insert with check (
    exists (
      select 1 from projects p
      where p.id = tasks.project_id and is_workspace_member(p.workspace_id)
    )
  );
create policy "Members can update tasks" on tasks
  for update using (
    exists (
      select 1 from projects p
      where p.id = tasks.project_id and is_workspace_member(p.workspace_id)
    )
  );
create policy "Owners/Admins can delete tasks" on tasks
  for delete using (
    exists (
      select 1 from projects p
      where p.id = tasks.project_id and is_workspace_owner_or_admin(p.workspace_id)
    )
  );

-- Canvas Nodes
alter table canvas_nodes enable row level security;
create policy "Members can view canvas nodes" on canvas_nodes
  for select using (
    exists (
      select 1 from canvases c
      join projects p on p.id = c.project_id
      where c.id = canvas_nodes.canvas_id and is_workspace_member(p.workspace_id)
    )
  );
create policy "Members can manage canvas nodes" on canvas_nodes
  for all using (
    exists (
      select 1 from canvases c
      join projects p on p.id = c.project_id
      where c.id = canvas_nodes.canvas_id and is_workspace_member(p.workspace_id)
    )
  );

-- Canvas Edges
alter table canvas_edges enable row level security;
create policy "Members can view canvas edges" on canvas_edges
  for select using (
    exists (
      select 1 from canvases c
      join projects p on p.id = c.project_id
      where c.id = canvas_edges.canvas_id and is_workspace_member(p.workspace_id)
    )
  );
create policy "Members can manage canvas edges" on canvas_edges
  for all using (
    exists (
      select 1 from canvases c
      join projects p on p.id = c.project_id
      where c.id = canvas_edges.canvas_id and is_workspace_member(p.workspace_id)
    )
  );

-- Comments
alter table comments enable row level security;
create policy "Members can view comments" on comments
  for select using (is_workspace_member(workspace_id));
create policy "Members can create comments" on comments
  for insert with check (is_workspace_member(workspace_id));
create policy "Authors can update their comments" on comments
  for update using (author_user_id = auth.uid());
create policy "Owners/Admins can delete comments" on comments
  for delete using (is_workspace_owner_or_admin(workspace_id));

-- AI Provider Keys - Restricted to Owner/Admin
alter table ai_provider_keys enable row level security;
create policy "Owners/Admins can view AI keys" on ai_provider_keys
  for select using (is_workspace_owner_or_admin(workspace_id));
create policy "Owners/Admins can manage AI keys" on ai_provider_keys
  for all using (is_workspace_owner_or_admin(workspace_id));

-- Agent Tokens - Restricted to Owner/Admin
alter table agent_tokens enable row level security;
create policy "Owners/Admins can view agent tokens" on agent_tokens
  for select using (is_workspace_owner_or_admin(workspace_id));
create policy "Owners/Admins can manage agent tokens" on agent_tokens
  for all using (is_workspace_owner_or_admin(workspace_id));

-- Activity Logs
alter table activity_logs enable row level security;
create policy "Members can view activity logs" on activity_logs
  for select using (is_workspace_member(workspace_id));
create policy "System can insert activity logs" on activity_logs
  for insert with check (true);

-- Updated at triggers
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger update_canvases_updated_at
  before update on canvases
  for each row
  execute function update_updated_at_column();

create trigger update_canvas_nodes_updated_at
  before update on canvas_nodes
  for each row
  execute function update_updated_at_column();

create trigger update_tasks_updated_at
  before update on tasks
  for each row
  execute function update_updated_at_column();

-- Function to bootstrap default workspace, project, and canvas for new users
create or replace function bootstrap_user_workspace()
returns trigger as $$
declare
  v_workspace_id uuid;
  v_project_id uuid;
  v_canvas_id uuid;
  v_frame_id uuid;
  v_card1_id uuid;
  v_card2_id uuid;
begin
  -- Create workspace
  insert into workspaces (name, slug, created_by)
  values ('Meu Workspace', 'workspace-' || substr(new.id::text, 1, 8), new.id)
  returning id into v_workspace_id;

  -- Add user as owner
  insert into workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, new.id, 'owner');

  -- Create default project
  insert into projects (workspace_id, name, slug, key_prefix, description)
  values (v_workspace_id, 'Projeto Exemplo', 'app', 'APP', 'Projeto de exemplo para começar')
  returning id into v_project_id;

  -- Create default canvas
  insert into canvases (project_id, name, is_default)
  values (v_project_id, 'Canvas Principal', true)
  returning id into v_canvas_id;

  -- Create AI Inbox frame
  insert into canvas_nodes (canvas_id, node_type, position_x, position_y, width, height, data)
  values (v_canvas_id, 'frame', 100, 100, 800, 600, '{"title": "Inbox da IA", "description": "Cards criados por agentes externos aparecem aqui", "isAIInbox": true}')
  returning id into v_frame_id;

  -- Create welcome sticky note 1
  insert into canvas_nodes (canvas_id, node_type, parent_frame_id, position_x, position_y, data)
  values (v_canvas_id, 'sticky_note', v_frame_id, 150, 150, '{"color": "#fef9c3", "text": "Bem-vindo ao CanvasFlow AI! 🎉\n\nArraste este post-it ou crie novos com a ferramenta de nota (N).\n\nClique em \"Promover para Tarefa\" para transformar em card oficial do backlog."}')
  returning id into v_card1_id;

  -- Create welcome sticky note 2
  insert into canvas_nodes (canvas_id, node_type, parent_frame_id, position_x, position_y, data)
  values (v_canvas_id, 'sticky_note', v_frame_id, 150, 350, '{"color": "#dcfce7", "text": "Fluxo sugerido:\n1. Faça brainstorming com post-its\n2. Use IA (⌘K) para agrupar ou quebrar épicos\n3. Promova para tarefas oficiais\n4. Escreva specs no Document Canvas\n5. Conecte via MCP para agentes externos"}')
  returning id into v_card2_id;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_bootstrap_user_workspace
after insert on auth.users
for each row
execute function bootstrap_user_workspace();