-- 0236 — conexões com sistemas externos via MCP (Model Context Protocol).
--
-- Mesmo molde de `ai_provider_credentials` (migration original) e
-- `map_provider_credentials` (0232): URL + chave cifrada, por organização,
-- validada contra o sistema de verdade antes de valer. Diferença aqui é que
-- não há "provider" fixo — qualquer servidor MCP de terceiro serve, então o
-- que se guarda é a URL em vez de um enum de provedor.
create table if not exists public.external_mcp_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  label text not null,
  mcp_url text not null,

  api_key_encrypted bytea not null,
  api_key_iv bytea not null,
  api_key_tag bytea not null,
  api_key_last4 text not null,

  validated_at timestamptz,
  validation_error text,
  -- Preenchido na validação — nomes das tools que o servidor externo devolveu,
  -- só pra tela mostrar "conectado, achei 4 ferramentas" sem precisar
  -- reconectar toda vez que alguém abre a lista.
  tools_encontradas jsonb not null default '[]'::jsonb,

  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint external_mcp_connections_url_https check (mcp_url ~ '^https://'),
  constraint external_mcp_connections_label_nao_vazio check (length(btrim(label)) > 0)
);

create unique index if not exists external_mcp_connections_org_label_key
  on public.external_mcp_connections (organization_id, label);

create index if not exists external_mcp_connections_org_ativas_idx
  on public.external_mcp_connections (organization_id, is_active);

alter table public.external_mcp_connections enable row level security;

drop policy if exists tenant_isolation_external_mcp_connections_select on public.external_mcp_connections;
create policy tenant_isolation_external_mcp_connections_select on public.external_mcp_connections
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists tenant_isolation_external_mcp_connections_write on public.external_mcp_connections;
create policy tenant_isolation_external_mcp_connections_write on public.external_mcp_connections
  using (
    (organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'admin')
  )
  with check (
    (organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'admin')
  );

-- Nomes GENÉRICOS de propósito — ver o comentário idêntico em 0232/0234: a
-- varredura dinâmica do baseline recria essas 3 policies com esses nomes
-- exatos em toda tabela tenant-writable a cada apply.
drop policy if exists support_write_insert on public.external_mcp_connections;
create policy support_write_insert on public.external_mcp_connections
  as restrictive for insert to authenticated
  with check (public.fn_support_write_allowed(organization_id));

drop policy if exists support_write_update on public.external_mcp_connections;
create policy support_write_update on public.external_mcp_connections
  as restrictive for update to authenticated
  using (public.fn_support_write_allowed(organization_id))
  with check (public.fn_support_write_allowed(organization_id));

drop policy if exists support_write_delete on public.external_mcp_connections;
create policy support_write_delete on public.external_mcp_connections
  as restrictive for delete to authenticated
  using (public.fn_support_write_allowed(organization_id));

-- View segura — nunca expõe as 3 colunas cifradas, mesmo padrão das outras
-- duas tabelas de credencial.
create or replace view public.external_mcp_connections_safe with (security_invoker = true) as
  select id, organization_id, label, mcp_url, api_key_last4, validated_at,
         validation_error, tools_encontradas, is_active, created_by, created_at, updated_at
    from public.external_mcp_connections;

revoke all on public.external_mcp_connections from anon;
grant select, insert, update, delete on public.external_mcp_connections to authenticated;
grant all on public.external_mcp_connections to service_role;
grant select on public.external_mcp_connections_safe to authenticated;

drop trigger if exists trg_external_mcp_connections_touch on public.external_mcp_connections;
create trigger trg_external_mcp_connections_touch
  before update on public.external_mcp_connections
  for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_external_mcp_connections_audit on public.external_mcp_connections;
create trigger trg_external_mcp_connections_audit
  after insert or delete or update on public.external_mcp_connections
  for each row execute function public.fn_audit_log_row();

comment on table public.external_mcp_connections is
  'Conexão com um servidor MCP de outro sistema (URL + chave cifrada), por organização. Validada contra o servidor de verdade antes de ativar.';

notify pgrst, 'reload schema';
