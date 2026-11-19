-- Correção: todas as funções precisam de SET search_path fixo.
-- No Supabase hospedado, o serviço de auth (supabase_auth_admin) roda com
-- search_path = auth, então nomes de tabelas não-qualificados não resolvem
-- public.* e o signup falha com "Database error saving new user".

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

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

create or replace function bootstrap_user_workspace()
returns trigger as $$
declare
  v_workspace_id uuid;
  v_project_id uuid;
  v_canvas_id uuid;
  v_frame_id uuid;
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
  values (v_canvas_id, 'sticky_note', v_frame_id, 150, 150, '{"color": "#fef9c3", "text": "Bem-vindo ao CanvasFlow AI! 🎉\n\nArraste este post-it ou crie novos com a ferramenta de nota (N).\n\nClique em \"Promover para Tarefa\" para transformar em card oficial do backlog."}');

  -- Create welcome sticky note 2
  insert into canvas_nodes (canvas_id, node_type, parent_frame_id, position_x, position_y, data)
  values (v_canvas_id, 'sticky_note', v_frame_id, 150, 350, '{"color": "#dcfce7", "text": "Fluxo sugerido:\n1. Faça brainstorming com post-its\n2. Use IA (⌘K) para agrupar ou quebrar épicos\n3. Promova para tarefas oficiais\n4. Escreva specs no Document Canvas\n5. Conecte via MCP para agentes externos"}');

  return new;
end;
$$ language plpgsql security definer set search_path = public;
