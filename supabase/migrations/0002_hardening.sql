-- =============================================================================
-- 0002 — Hardening: RLS por papel, integridade, dependências como fonte da
-- verdade, auditoria por trigger, RPCs transacionais, convites e expiração.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helpers de autorização
-- -----------------------------------------------------------------------------

-- Pode escrever: owner, admin ou member (viewer é somente leitura)
create or replace function is_workspace_writer(ws_id uuid)
returns boolean as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid() and role in ('owner', 'admin', 'member')
  );
$$ language sql security definer stable set search_path = public;

create or replace function is_workspace_owner(ws_id uuid)
returns boolean as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid() and role = 'owner'
  );
$$ language sql security definer stable set search_path = public;

create or replace function project_workspace_id(p_project_id uuid)
returns uuid as $$
  select workspace_id from projects where id = p_project_id;
$$ language sql security definer stable set search_path = public;

create or replace function canvas_workspace_id(p_canvas_id uuid)
returns uuid as $$
  select p.workspace_id from canvases c join projects p on p.id = c.project_id where c.id = p_canvas_id;
$$ language sql security definer stable set search_path = public;

-- -----------------------------------------------------------------------------
-- 2. task_key: o trigger roda como definer (membros comuns não têm UPDATE em
--    projects) e falha explicitamente se o projeto não existir.
-- -----------------------------------------------------------------------------
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

  if v_prefix is null then
    raise exception 'Projeto % não encontrado ao gerar task_key', new.project_id;
  end if;

  new.task_key := v_prefix || '-' || v_counter;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- task_key passa a ser único dentro do workspace (prefixo único por workspace)
alter table projects
  add constraint projects_workspace_key_prefix_key unique (workspace_id, key_prefix);

-- Índices de suporte
create index if not exists idx_tasks_project_created on tasks(project_id, created_at);
create index if not exists idx_tasks_parent on tasks(parent_task_id);
create index if not exists idx_canvas_edges_canvas on canvas_edges(canvas_id);
create index if not exists idx_canvas_edges_source on canvas_edges(source_node_id);
create index if not exists idx_canvas_edges_target on canvas_edges(target_node_id);
create index if not exists idx_comments_task on comments(task_id);
create index if not exists idx_activity_logs_task on activity_logs(task_id, created_at);

-- -----------------------------------------------------------------------------
-- 3. Políticas de escrita: viewer passa a ser somente leitura
-- -----------------------------------------------------------------------------

-- Projects
drop policy if exists "Members can create projects" on projects;
create policy "Writers can create projects" on projects
  for insert with check (is_workspace_writer(workspace_id));

-- Canvases
drop policy if exists "Members can create canvases" on canvases;
drop policy if exists "Members can update canvases" on canvases;
create policy "Writers can create canvases" on canvases
  for insert with check (is_workspace_writer(project_workspace_id(project_id)));
create policy "Writers can update canvases" on canvases
  for update using (is_workspace_writer(project_workspace_id(project_id)))
  with check (is_workspace_writer(project_workspace_id(project_id)));

-- Tasks
drop policy if exists "Members can create tasks" on tasks;
drop policy if exists "Members can update tasks" on tasks;
create policy "Writers can create tasks" on tasks
  for insert with check (is_workspace_writer(project_workspace_id(project_id)));
create policy "Writers can update tasks" on tasks
  for update using (is_workspace_writer(project_workspace_id(project_id)))
  with check (is_workspace_writer(project_workspace_id(project_id)));

-- Canvas nodes
drop policy if exists "Members can manage canvas nodes" on canvas_nodes;
create policy "Writers can insert canvas nodes" on canvas_nodes
  for insert with check (is_workspace_writer(canvas_workspace_id(canvas_id)));
create policy "Writers can update canvas nodes" on canvas_nodes
  for update using (is_workspace_writer(canvas_workspace_id(canvas_id)))
  with check (is_workspace_writer(canvas_workspace_id(canvas_id)));
create policy "Writers can delete canvas nodes" on canvas_nodes
  for delete using (is_workspace_writer(canvas_workspace_id(canvas_id)));

-- Canvas edges
drop policy if exists "Members can manage canvas edges" on canvas_edges;
create policy "Writers can insert canvas edges" on canvas_edges
  for insert with check (is_workspace_writer(canvas_workspace_id(canvas_id)));
create policy "Writers can update canvas edges" on canvas_edges
  for update using (is_workspace_writer(canvas_workspace_id(canvas_id)))
  with check (is_workspace_writer(canvas_workspace_id(canvas_id)));
create policy "Writers can delete canvas edges" on canvas_edges
  for delete using (is_workspace_writer(canvas_workspace_id(canvas_id)));

-- Comments: autoria verificada; somente humanos via cliente
drop policy if exists "Members can create comments" on comments;
drop policy if exists "Authors can update their comments" on comments;
create policy "Writers can create own comments" on comments
  for insert with check (
    is_workspace_writer(workspace_id)
    and author_user_id = auth.uid()
    and actor_type = 'human'
  );
-- Qualquer writer pode resolver; o trigger comments_guard impede editar texto alheio
create policy "Writers can update comments" on comments
  for update using (is_workspace_writer(workspace_id))
  with check (is_workspace_writer(workspace_id));
-- Autoria sozinha não basta: quem foi rebaixado a viewer perde o direito de apagar
create policy "Authors can delete their comments" on comments
  for delete using (author_user_id = auth.uid() and is_workspace_writer(workspace_id));

-- Activity logs: nunca mais `with check (true)`
drop policy if exists "System can insert activity logs" on activity_logs;
create policy "Members can insert own activity logs" on activity_logs
  for insert with check (
    is_workspace_writer(workspace_id)
    and actor_user_id = auth.uid()
    and actor_type in ('human', 'internal_ai')
  );

-- Workspace members: admin não mexe em owner; só owner cria/promove owner
drop policy if exists "Owners/Admins can manage members" on workspace_members;
create policy "Admins can add members" on workspace_members
  for insert with check (
    is_workspace_owner_or_admin(workspace_id)
    and (role <> 'owner' or is_workspace_owner(workspace_id))
  );
create policy "Admins can update members" on workspace_members
  for update using (
    is_workspace_owner_or_admin(workspace_id)
    and (role <> 'owner' or is_workspace_owner(workspace_id))
  )
  with check (
    is_workspace_owner_or_admin(workspace_id)
    and (role <> 'owner' or is_workspace_owner(workspace_id))
  );
create policy "Admins can remove members or self leave" on workspace_members
  for delete using (
    user_id = auth.uid()
    or (
      is_workspace_owner_or_admin(workspace_id)
      and (role <> 'owner' or is_workspace_owner(workspace_id))
    )
  );

-- -----------------------------------------------------------------------------
-- 4. Triggers de integridade
-- -----------------------------------------------------------------------------

-- Nunca deixar um workspace sem owner (apenas para requisições de usuários;
-- service role / cascatas administrativas passam)
create or replace function guard_last_owner()
returns trigger as $$
declare
  v_remaining integer;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    select count(*) into v_remaining
    from workspace_members
    where workspace_id = old.workspace_id and role = 'owner' and user_id <> old.user_id;
    if v_remaining = 0 then
      raise exception 'O workspace precisa de pelo menos um owner';
    end if;
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_workspace_members_last_owner
before update or delete on workspace_members
for each row execute function guard_last_owner();

-- Tasks: regras para escritas feitas por usuários (cliente/anon key)
--  * usuários não podem se passar por agente externo
--  * agent_execution_log é exclusivo dos agentes (via RPC com service role)
--  * project_id e task_key são imutáveis
-- E para todos (inclusive service role): agente externo só conclui ('done')
-- quando a RPC habilitou app.agent_allow_direct_done.
create or replace function guard_task_writes()
returns trigger as $$
begin
  if auth.uid() is not null then
    if new.last_updated_by_type = 'external_agent' then
      if tg_op = 'UPDATE' and old.last_updated_by_type = 'external_agent' then
        -- Cliente não informou o ator: a alteração é humana
        new.last_updated_by_type := 'human';
        if new.last_updated_by_label is not distinct from old.last_updated_by_label then
          new.last_updated_by_label := null;
        end if;
      else
        raise exception 'Usuários não podem registrar alterações como agente externo';
      end if;
    end if;
    if tg_op = 'INSERT' then
      if new.agent_execution_log is distinct from '[]'::jsonb then
        raise exception 'agent_execution_log só pode ser escrito por agentes';
      end if;
    else
      if new.agent_execution_log is distinct from old.agent_execution_log then
        raise exception 'agent_execution_log só pode ser escrito por agentes';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'project_id de uma tarefa é imutável';
    end if;
    if new.task_key is distinct from old.task_key then
      raise exception 'task_key é imutável';
    end if;
  end if;

  if new.last_updated_by_type = 'external_agent'
     and new.status = 'done'
     and (tg_op = 'INSERT' or old.status is distinct from 'done')
     and coalesce(current_setting('app.agent_allow_direct_done', true), 'off') <> 'on' then
    raise exception 'Guardrail: agentes externos não podem concluir tarefas sem aprovação humana';
  end if;

  if new.parent_task_id is not null then
    if new.parent_task_id = new.id then
      raise exception 'Uma tarefa não pode ser pai de si mesma';
    end if;
    if not exists (select 1 from tasks where id = new.parent_task_id and project_id = new.project_id) then
      raise exception 'parent_task_id deve pertencer ao mesmo projeto';
    end if;
  end if;

  return new;
end;
$$ language plpgsql set search_path = public;

create trigger trg_tasks_guard
before insert or update on tasks
for each row execute function guard_task_writes();

-- Comments: não editar texto/autoria alheios; vínculos coerentes com o workspace
create or replace function guard_comment_writes()
returns trigger as $$
begin
  if new.task_id is not null and not exists (
    select 1 from tasks t join projects p on p.id = t.project_id
    where t.id = new.task_id and p.workspace_id = new.workspace_id
  ) then
    raise exception 'A tarefa do comentário não pertence ao workspace';
  end if;
  if new.canvas_id is not null and canvas_workspace_id(new.canvas_id) is distinct from new.workspace_id then
    raise exception 'O canvas do comentário não pertence ao workspace';
  end if;

  if tg_op = 'UPDATE' and auth.uid() is not null then
    if new.author_user_id is distinct from old.author_user_id
       or new.actor_type is distinct from old.actor_type
       or new.author_label is distinct from old.author_label
       or new.workspace_id is distinct from old.workspace_id
       or new.task_id is distinct from old.task_id then
      raise exception 'Autoria e vínculos de comentários são imutáveis';
    end if;
    if new.body_markdown is distinct from old.body_markdown
       and old.author_user_id is distinct from auth.uid() then
      raise exception 'Apenas o autor pode editar o texto do comentário';
    end if;
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger trg_comments_guard
before insert or update on comments
for each row execute function guard_comment_writes();

-- Canvas nodes: um card só pode apontar para tarefa do mesmo projeto do canvas
create or replace function guard_canvas_node_writes()
returns trigger as $$
begin
  if new.task_id is not null and not exists (
    select 1 from tasks t join canvases c on c.project_id = t.project_id
    where t.id = new.task_id and c.id = new.canvas_id
  ) then
    raise exception 'A tarefa do nó não pertence ao projeto do canvas';
  end if;
  if new.parent_frame_id is not null and not exists (
    select 1 from canvas_nodes f where f.id = new.parent_frame_id and f.canvas_id = new.canvas_id
  ) then
    raise exception 'parent_frame_id deve estar no mesmo canvas';
  end if;
  if tg_op = 'UPDATE' and new.canvas_id is distinct from old.canvas_id then
    raise exception 'canvas_id de um nó é imutável';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger trg_canvas_nodes_guard
before insert or update on canvas_nodes
for each row execute function guard_canvas_node_writes();

-- Canvas edges: origem e destino no mesmo canvas da aresta
create or replace function guard_canvas_edge_writes()
returns trigger as $$
begin
  if new.source_node_id = new.target_node_id then
    raise exception 'Uma aresta não pode ligar um nó a ele mesmo';
  end if;
  if (select count(*) from canvas_nodes
      where id in (new.source_node_id, new.target_node_id) and canvas_id = new.canvas_id) <> 2 then
    raise exception 'Origem e destino da aresta devem estar no mesmo canvas';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger trg_canvas_edges_guard
before insert or update on canvas_edges
for each row execute function guard_canvas_edge_writes();

-- -----------------------------------------------------------------------------
-- 5. Dependências entre tarefas: fonte da verdade no backlog.
--    canvas_edges entre task cards são apenas a projeção visual.
-- -----------------------------------------------------------------------------
create table task_dependencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  source_task_id uuid not null references tasks(id) on delete cascade,
  target_task_id uuid not null references tasks(id) on delete cascade,
  dependency_type canvas_edge_type not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_task_id, target_task_id, dependency_type),
  check (source_task_id <> target_task_id)
);

create index idx_task_dependencies_source on task_dependencies(source_task_id);
create index idx_task_dependencies_target on task_dependencies(target_task_id);
create index idx_task_dependencies_project on task_dependencies(project_id);

alter table task_dependencies enable row level security;
create policy "Members can view dependencies" on task_dependencies
  for select using (is_workspace_member(project_workspace_id(project_id)));
create policy "Writers can create dependencies" on task_dependencies
  for insert with check (is_workspace_writer(project_workspace_id(project_id)));
create policy "Writers can delete dependencies" on task_dependencies
  for delete using (is_workspace_writer(project_workspace_id(project_id)));

create or replace function guard_task_dependency_writes()
returns trigger as $$
begin
  if (select count(*) from tasks
      where id in (new.source_task_id, new.target_task_id) and project_id = new.project_id) <> 2 then
    raise exception 'As tarefas da dependência devem pertencer ao projeto informado';
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger trg_task_dependencies_guard
before insert on task_dependencies
for each row execute function guard_task_dependency_writes();

-- Aresta criada entre dois task cards => registra a dependência
create or replace function sync_dependency_from_edge()
returns trigger as $$
declare
  v_source_task uuid;
  v_target_task uuid;
  v_project uuid;
begin
  select task_id into v_source_task from canvas_nodes where id = new.source_node_id;
  select task_id into v_target_task from canvas_nodes where id = new.target_node_id;
  if v_source_task is null or v_target_task is null then
    return new;
  end if;
  select project_id into v_project from canvases where id = new.canvas_id;

  insert into task_dependencies (project_id, source_task_id, target_task_id, dependency_type, created_by)
  values (v_project, v_source_task, v_target_task, new.edge_type, auth.uid())
  on conflict (source_task_id, target_task_id, dependency_type) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_canvas_edges_sync_dependency
after insert on canvas_edges
for each row execute function sync_dependency_from_edge();

-- Aresta removida explicitamente (ambos os nós ainda existem) => remove a dependência.
-- Se a remoção veio em cascata (nó/canvas apagado), a dependência é preservada.
create or replace function sync_dependency_on_edge_delete()
returns trigger as $$
declare
  v_source_task uuid;
  v_target_task uuid;
begin
  select task_id into v_source_task from canvas_nodes where id = old.source_node_id;
  select task_id into v_target_task from canvas_nodes where id = old.target_node_id;
  if v_source_task is null or v_target_task is null then
    return old;
  end if;
  delete from task_dependencies
  where source_task_id = v_source_task
    and target_task_id = v_target_task
    and dependency_type = old.edge_type;
  return old;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_canvas_edges_sync_dependency_delete
after delete on canvas_edges
for each row execute function sync_dependency_on_edge_delete();

-- Dependência criada (ex.: via MCP) => projeta arestas em todos os canvases
-- onde as duas tarefas têm card
create or replace function project_dependency_to_canvases()
returns trigger as $$
begin
  insert into canvas_edges (canvas_id, source_node_id, target_node_id, edge_type)
  select s.canvas_id, s.id, t.id, new.dependency_type
  from canvas_nodes s
  join canvas_nodes t on t.canvas_id = s.canvas_id
  where s.task_id = new.source_task_id and t.task_id = new.target_task_id
  on conflict (canvas_id, source_node_id, target_node_id, edge_type) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_task_dependencies_project
after insert on task_dependencies
for each row execute function project_dependency_to_canvases();

create or replace function unproject_dependency_from_canvases()
returns trigger as $$
begin
  delete from canvas_edges e
  using canvas_nodes s, canvas_nodes t
  where e.source_node_id = s.id and e.target_node_id = t.id
    and s.task_id = old.source_task_id and t.task_id = old.target_task_id
    and e.edge_type = old.dependency_type;
  return old;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_task_dependencies_unproject
after delete on task_dependencies
for each row execute function unproject_dependency_from_canvases();

-- Card de tarefa (re)adicionado a um canvas => recria as arestas das dependências existentes
create or replace function project_dependencies_for_new_node()
returns trigger as $$
begin
  if new.task_id is null or (tg_op = 'UPDATE' and old.task_id is not distinct from new.task_id) then
    return new;
  end if;

  insert into canvas_edges (canvas_id, source_node_id, target_node_id, edge_type)
  select new.canvas_id, new.id, t.id, d.dependency_type
  from task_dependencies d
  join canvas_nodes t on t.task_id = d.target_task_id and t.canvas_id = new.canvas_id
  where d.source_task_id = new.task_id
  on conflict (canvas_id, source_node_id, target_node_id, edge_type) do nothing;

  insert into canvas_edges (canvas_id, source_node_id, target_node_id, edge_type)
  select new.canvas_id, s.id, new.id, d.dependency_type
  from task_dependencies d
  join canvas_nodes s on s.task_id = d.source_task_id and s.canvas_id = new.canvas_id
  where d.target_task_id = new.task_id
  on conflict (canvas_id, source_node_id, target_node_id, edge_type) do nothing;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_canvas_nodes_project_dependencies
after insert or update of task_id on canvas_nodes
for each row execute function project_dependencies_for_new_node();

-- Backfill a partir das arestas existentes
insert into task_dependencies (project_id, source_task_id, target_task_id, dependency_type)
select c.project_id, s.task_id, t.task_id, e.edge_type
from canvas_edges e
join canvas_nodes s on s.id = e.source_node_id
join canvas_nodes t on t.id = e.target_node_id
join canvases c on c.id = e.canvas_id
where s.task_id is not null and t.task_id is not null and s.task_id <> t.task_id
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 6. Auditoria confiável: tarefas são logadas pelo banco, não pelo cliente.
--    RPCs podem anexar contexto via set_config('app.activity_payload', json, true).
-- -----------------------------------------------------------------------------
create or replace function log_task_activity()
returns trigger as $$
declare
  v_workspace uuid;
  v_action text;
  v_payload jsonb;
  v_extra jsonb;
  v_changed text[];
  v_actor_type actor_type;
  v_actor_label text;
begin
  select workspace_id into v_workspace from projects where id = new.project_id;

  if tg_op = 'INSERT' then
    v_action := 'task.created';
    v_payload := jsonb_build_object('title', new.title, 'type', new.type, 'task_key', new.task_key);
  elsif new.status is distinct from old.status then
    v_action := 'task.status_changed';
    v_payload := jsonb_build_object('from', old.status, 'to', new.status);
  elsif new.agent_execution_log is distinct from old.agent_execution_log then
    v_action := 'agent.note_appended';
    v_payload := jsonb_build_object('entries', jsonb_array_length(new.agent_execution_log));
  else
    select array_agg(key order by key) into v_changed
    from jsonb_each(to_jsonb(new)) n
    where key not in ('updated_at', 'last_updated_by_type', 'last_updated_by_label')
      and n.value is distinct from (to_jsonb(old) -> key);
    if v_changed is null then
      return new;
    end if;
    v_action := 'task.updated';
    v_payload := jsonb_build_object('updates', to_jsonb(v_changed));
  end if;

  v_extra := nullif(current_setting('app.activity_payload', true), '')::jsonb;
  if v_extra is not null then
    v_payload := v_payload || v_extra;
  end if;

  -- Atribuição vem da identidade autenticada, nunca dos campos last_updated_by_*
  -- (editáveis pelo cliente). Sem auth.uid() a escrita veio do servidor: as RPCs
  -- de agente definem o rótulo a partir do token MCP validado.
  if auth.uid() is not null then
    select coalesce(
             nullif(u.raw_user_meta_data ->> 'name', ''),
             nullif(u.raw_user_meta_data ->> 'full_name', ''),
             split_part(u.email, '@', 1),
             'Usuário'
           )
      into v_actor_label
      from auth.users u
     where u.id = auth.uid();
    v_actor_type := case when new.last_updated_by_type = 'internal_ai' then 'internal_ai'::actor_type
                         else 'human'::actor_type end;
    if v_actor_type = 'internal_ai' then
      v_actor_label := 'IA Interna (via ' || coalesce(v_actor_label, 'Usuário') || ')';
    end if;
  else
    v_actor_type := new.last_updated_by_type;
    v_actor_label := new.last_updated_by_label;
  end if;

  insert into activity_logs (workspace_id, project_id, task_id, actor_type, actor_user_id, actor_label, action, payload)
  values (
    v_workspace, new.project_id, new.id, v_actor_type, auth.uid(),
    coalesce(v_actor_label, 'Sistema'), v_action, v_payload
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_tasks_activity
after insert or update on tasks
for each row execute function log_task_activity();

-- -----------------------------------------------------------------------------
-- 7. Tokens MCP com expiração; chaves BYOK versionadas e uma ativa por workspace
-- -----------------------------------------------------------------------------
alter table agent_tokens add column expires_at timestamptz;

alter table ai_provider_keys add column key_version integer not null default 1;

-- Mantém apenas a chave ativa mais recente antes de impor a unicidade
update ai_provider_keys k
set is_active = false
where is_active
  and exists (
    select 1 from ai_provider_keys k2
    where k2.workspace_id = k.workspace_id and k2.is_active and k2.created_at > k.created_at
  );
create unique index ai_provider_keys_one_active
  on ai_provider_keys(workspace_id) where is_active;

-- -----------------------------------------------------------------------------
-- 8. Convites de workspace (link de uso único; token guardado como SHA-256)
-- -----------------------------------------------------------------------------
create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text,
  role workspace_role not null default 'member' check (role <> 'owner'),
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table workspace_invites enable row level security;
create policy "Admins can view invites" on workspace_invites
  for select using (is_workspace_owner_or_admin(workspace_id));
create policy "Admins can create invites" on workspace_invites
  for insert with check (is_workspace_owner_or_admin(workspace_id) and created_by = auth.uid());
create policy "Admins can revoke invites" on workspace_invites
  for update using (is_workspace_owner_or_admin(workspace_id))
  with check (is_workspace_owner_or_admin(workspace_id));

create or replace function accept_workspace_invite(p_token_hash text)
returns jsonb as $$
declare
  v_invite workspace_invites%rowtype;
  v_slug text;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_invite from workspace_invites
  where token_hash = p_token_hash
  for update;

  if not found or v_invite.revoked_at is not null or v_invite.accepted_at is not null
     or v_invite.expires_at < now() then
    raise exception 'Convite inválido ou expirado';
  end if;

  if v_invite.email is not null then
    select email into v_email from auth.users where id = auth.uid();
    if lower(coalesce(v_email, '')) <> lower(v_invite.email) then
      raise exception 'Este convite foi emitido para outro email';
    end if;
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, auth.uid(), v_invite.role)
  on conflict (workspace_id, user_id) do nothing;

  update workspace_invites
  set accepted_at = now(), accepted_by = auth.uid()
  where id = v_invite.id;

  select slug into v_slug from workspaces where id = v_invite.workspace_id;
  return jsonb_build_object('workspace_id', v_invite.workspace_id, 'workspace_slug', v_slug);
end;
$$ language plpgsql security definer set search_path = public;

-- -----------------------------------------------------------------------------
-- 9. RPCs transacionais para o cliente (SECURITY INVOKER: RLS se aplica)
-- -----------------------------------------------------------------------------

-- Cria tarefa + card no canvas numa única transação
create or replace function create_task_with_node(
  p_canvas_id uuid,
  p_title text,
  p_position_x double precision,
  p_position_y double precision,
  p_type task_type default 'task',
  p_priority task_priority default 'medium',
  p_status task_status default 'backlog',
  p_spec_markdown text default '',
  p_acceptance_criteria jsonb default '[]'::jsonb,
  p_actor_type actor_type default 'human',
  p_actor_label text default null,
  p_needs_auto_layout boolean default false
)
returns jsonb as $$
declare
  v_project uuid;
  v_task tasks%rowtype;
  v_node canvas_nodes%rowtype;
begin
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Título obrigatório';
  end if;

  select project_id into v_project from canvases where id = p_canvas_id;
  if v_project is null then
    raise exception 'Canvas não encontrado';
  end if;

  insert into tasks (project_id, title, type, priority, status, spec_markdown, acceptance_criteria,
                     last_updated_by_type, last_updated_by_label)
  values (v_project, left(trim(p_title), 300), p_type, p_priority, p_status, coalesce(p_spec_markdown, ''),
          coalesce(p_acceptance_criteria, '[]'::jsonb), p_actor_type, p_actor_label)
  returning * into v_task;

  insert into canvas_nodes (canvas_id, node_type, task_id, position_x, position_y, needs_auto_layout, data)
  values (p_canvas_id, 'task_card', v_task.id, p_position_x, p_position_y, p_needs_auto_layout,
          jsonb_build_object('title', v_task.title))
  returning * into v_node;

  return jsonb_build_object('task', to_jsonb(v_task), 'node', to_jsonb(v_node));
end;
$$ language plpgsql security invoker set search_path = public;

-- Promove post-it em tarefa preservando posição e conexões
create or replace function promote_sticky_to_task(p_node_id uuid, p_actor_label text default null)
returns jsonb as $$
declare
  v_node canvas_nodes%rowtype;
  v_project uuid;
  v_text text;
  v_title text;
  v_task tasks%rowtype;
begin
  select * into v_node from canvas_nodes where id = p_node_id for update;
  if not found then
    raise exception 'Nó não encontrado';
  end if;
  if v_node.node_type <> 'sticky_note' then
    raise exception 'Apenas post-its podem ser promovidos';
  end if;

  select project_id into v_project from canvases where id = v_node.canvas_id;
  v_text := coalesce(v_node.data ->> 'text', '');
  v_title := left(nullif(trim(split_part(v_text, E'\n', 1)), ''), 300);

  insert into tasks (project_id, title, type, spec_markdown, last_updated_by_type, last_updated_by_label)
  values (v_project, coalesce(v_title, 'Nova tarefa'), 'task', v_text, 'human', p_actor_label)
  returning * into v_task;

  update canvas_nodes
  set node_type = 'task_card', task_id = v_task.id, data = jsonb_build_object('title', v_task.title)
  where id = p_node_id
  returning * into v_node;

  insert into activity_logs (workspace_id, project_id, task_id, actor_type, actor_user_id, actor_label, action, payload)
  values (project_workspace_id(v_project), v_project, v_task.id, 'human', auth.uid(),
          coalesce(p_actor_label, 'Usuário'), 'node.promoted',
          jsonb_build_object('node_id', p_node_id, 'task_key', v_task.task_key));

  return jsonb_build_object('task', to_jsonb(v_task), 'node', to_jsonb(v_node));
end;
$$ language plpgsql security invoker set search_path = public;

-- Cria projeto + canvas padrão + frame "Inbox da IA"
create or replace function create_project_with_canvas(
  p_workspace_id uuid,
  p_name text,
  p_slug text,
  p_key_prefix text,
  p_description text default null
)
returns jsonb as $$
declare
  v_project projects%rowtype;
  v_canvas canvases%rowtype;
begin
  insert into projects (workspace_id, name, slug, key_prefix, description)
  values (p_workspace_id, trim(p_name), lower(trim(p_slug)), upper(trim(p_key_prefix)), p_description)
  returning * into v_project;

  insert into canvases (project_id, name, is_default)
  values (v_project.id, 'Canvas Principal', true)
  returning * into v_canvas;

  insert into canvas_nodes (canvas_id, node_type, position_x, position_y, width, height, data)
  values (v_canvas.id, 'frame', 100, 100, 800, 600,
          '{"title": "Inbox da IA", "description": "Cards criados por agentes externos aparecem aqui", "isAIInbox": true}');

  return jsonb_build_object('project', to_jsonb(v_project), 'canvas', to_jsonb(v_canvas));
end;
$$ language plpgsql security invoker set search_path = public;

-- -----------------------------------------------------------------------------
-- 10. RPCs exclusivas de agentes (service role) — guardrail aplicado no banco
-- -----------------------------------------------------------------------------
create or replace function agent_update_task_status(
  p_task_id uuid,
  p_status task_status,
  p_entry jsonb,
  p_actor_label text,
  p_allow_direct_done boolean default false
)
returns jsonb as $$
declare
  v_task tasks%rowtype;
  v_final task_status := p_status;
  v_guardrail boolean := false;
begin
  select * into v_task from tasks where id = p_task_id for update;
  if not found then
    raise exception 'Tarefa não encontrada';
  end if;

  if p_status = 'done' and not p_allow_direct_done then
    v_final := 'in_review';
    v_guardrail := true;
  end if;

  perform set_config('app.agent_allow_direct_done', case when p_allow_direct_done then 'on' else 'off' end, true);
  perform set_config('app.activity_payload', jsonb_build_object(
    'requested_status', p_status,
    'guardrail_applied', v_guardrail,
    'summary', p_entry ->> 'summary',
    'commit_or_pr_url', p_entry ->> 'commit_or_pr_url'
  )::text, true);

  update tasks
  set status = v_final,
      agent_execution_log = agent_execution_log || jsonb_build_array(p_entry),
      last_updated_by_type = 'external_agent',
      last_updated_by_label = p_actor_label
  where id = p_task_id;

  perform set_config('app.activity_payload', '', true);
  perform set_config('app.agent_allow_direct_done', 'off', true);

  return jsonb_build_object(
    'task_key', v_task.task_key,
    'previous_status', v_task.status,
    'new_status', v_final,
    'guardrail_applied', v_guardrail
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function agent_append_note(p_task_id uuid, p_entry jsonb, p_actor_label text)
returns jsonb as $$
declare
  v_task tasks%rowtype;
begin
  perform set_config('app.activity_payload', jsonb_build_object('category', p_entry ->> 'category')::text, true);

  update tasks
  set agent_execution_log = agent_execution_log || jsonb_build_array(p_entry),
      last_updated_by_type = 'external_agent',
      last_updated_by_label = p_actor_label
  where id = p_task_id
  returning * into v_task;

  perform set_config('app.activity_payload', '', true);

  if v_task.id is null then
    raise exception 'Tarefa não encontrada';
  end if;
  return jsonb_build_object('task_key', v_task.task_key, 'log_entries', jsonb_array_length(v_task.agent_execution_log));
end;
$$ language plpgsql security definer set search_path = public;

create or replace function agent_create_linked_task(
  p_project_id uuid,
  p_title text,
  p_type task_type,
  p_actor_label text,
  p_priority task_priority default 'medium',
  p_spec_markdown text default '',
  p_acceptance_criteria jsonb default '[]'::jsonb,
  p_parent_task_key text default null,
  p_edge_type canvas_edge_type default null
)
returns jsonb as $$
declare
  v_canvas uuid;
  v_parent tasks%rowtype;
  v_task tasks%rowtype;
  v_node uuid;
  v_edge_type canvas_edge_type := coalesce(p_edge_type, 'parent_of');
begin
  -- Validações ANTES de qualquer escrita: nada de tarefas órfãs
  select id into v_canvas from canvases where project_id = p_project_id and is_default limit 1;
  if v_canvas is null then
    raise exception 'Projeto sem canvas padrão';
  end if;

  if p_parent_task_key is not null then
    select * into v_parent from tasks where project_id = p_project_id and task_key = p_parent_task_key;
    if not found then
      raise exception 'Tarefa pai % não encontrada', p_parent_task_key;
    end if;
  end if;

  insert into tasks (project_id, title, type, priority, spec_markdown, acceptance_criteria,
                     parent_task_id, last_updated_by_type, last_updated_by_label)
  values (p_project_id, left(trim(p_title), 300), p_type, coalesce(p_priority, 'medium'),
          coalesce(p_spec_markdown, ''), coalesce(p_acceptance_criteria, '[]'::jsonb),
          case when v_parent.id is not null and v_edge_type = 'parent_of' then v_parent.id end,
          'external_agent', p_actor_label)
  returning * into v_task;

  insert into canvas_nodes (canvas_id, node_type, task_id, needs_auto_layout, data)
  values (v_canvas, 'task_card', v_task.id, true, jsonb_build_object('title', v_task.title))
  returning id into v_node;

  if v_parent.id is not null then
    -- A dependência é a fonte da verdade; o trigger projeta a aresta no canvas
    insert into task_dependencies (project_id, source_task_id, target_task_id, dependency_type)
    values (p_project_id, v_parent.id, v_task.id, v_edge_type)
    on conflict do nothing;
  end if;

  return jsonb_build_object('task_id', v_task.id, 'task_key', v_task.task_key, 'canvas_node_id', v_node);
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function agent_update_task_status(uuid, task_status, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function agent_append_note(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function agent_create_linked_task(uuid, text, task_type, text, task_priority, text, jsonb, text, canvas_edge_type) from public, anon, authenticated;
grant execute on function agent_update_task_status(uuid, task_status, jsonb, text, boolean) to service_role;
grant execute on function agent_append_note(uuid, jsonb, text) to service_role;
grant execute on function agent_create_linked_task(uuid, text, task_type, text, task_priority, text, jsonb, text, canvas_edge_type) to service_role;

-- -----------------------------------------------------------------------------
-- 11. Bootstrap: slug sem colisão
-- -----------------------------------------------------------------------------
create or replace function bootstrap_user_workspace()
returns trigger as $$
declare
  v_workspace_id uuid;
  v_project_id uuid;
  v_canvas_id uuid;
  v_frame_id uuid;
begin
  insert into workspaces (name, slug, created_by)
  -- UUID completo: o prefixo de 8 caracteres anterior permitia colisão
  values ('Meu Workspace', 'ws-' || replace(new.id::text, '-', ''), new.id)
  returning id into v_workspace_id;

  insert into workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, new.id, 'owner');

  insert into projects (workspace_id, name, slug, key_prefix, description)
  values (v_workspace_id, 'Projeto Exemplo', 'app', 'APP', 'Projeto de exemplo para começar')
  returning id into v_project_id;

  insert into canvases (project_id, name, is_default)
  values (v_project_id, 'Canvas Principal', true)
  returning id into v_canvas_id;

  insert into canvas_nodes (canvas_id, node_type, position_x, position_y, width, height, data)
  values (v_canvas_id, 'frame', 100, 100, 800, 600, '{"title": "Inbox da IA", "description": "Cards criados por agentes externos aparecem aqui", "isAIInbox": true}')
  returning id into v_frame_id;

  insert into canvas_nodes (canvas_id, node_type, parent_frame_id, position_x, position_y, data)
  values (v_canvas_id, 'sticky_note', v_frame_id, 150, 150, '{"color": "#fef9c3", "text": "Bem-vindo ao CanvasFlow AI! 🎉\n\nArraste este post-it ou crie novos com a ferramenta de nota (N).\n\nClique em \"Promover para Tarefa\" para transformar em card oficial do backlog."}');

  insert into canvas_nodes (canvas_id, node_type, parent_frame_id, position_x, position_y, data)
  values (v_canvas_id, 'sticky_note', v_frame_id, 150, 350, '{"color": "#dcfce7", "text": "Fluxo sugerido:\n1. Faça brainstorming com post-its\n2. Use IA (⌘K) para agrupar ou quebrar épicos\n3. Promova para tarefas oficiais\n4. Escreva specs no Document Canvas\n5. Conecte via MCP para agentes externos"}');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- -----------------------------------------------------------------------------
-- 12. Realtime
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table task_dependencies;
