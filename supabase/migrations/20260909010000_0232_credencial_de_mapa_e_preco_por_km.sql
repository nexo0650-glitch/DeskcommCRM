-- 0231 — formaliza `map_provider_credentials` (aplicada direto em produção numa
-- sessão anterior, sem passar por migration — dívida registrada e paga aqui) e
-- adiciona `catalog_products.price_per_km_cents` para o cálculo de orçamento
-- de remoção (preço fixo da modalidade + valor por km rodado).
--
-- Tudo idempotente: `create table/index if not exists`, `create or replace
-- view/function`, `drop policy/trigger if exists` + recriação. Reaplicar num
-- banco onde já existe (caso desta própria instalação) não duplica nem quebra.

-- ---- credencial de provedor de mapa (geocodificação/distância) ----
create table if not exists public.map_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  label text not null,
  api_key_encrypted bytea not null,
  api_key_iv bytea not null,
  api_key_tag bytea not null,
  api_key_last4 text not null,
  validated_at timestamptz,
  validation_error text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint map_provider_credentials_provider_check check (length(btrim(provider)) > 0)
);

create unique index if not exists map_provider_credentials_organization_id_provider_label_key
  on public.map_provider_credentials (organization_id, provider, label);

create index if not exists map_provider_credentials_org_provider_idx
  on public.map_provider_credentials (organization_id, provider) where is_active;

create or replace view public.map_provider_credentials_safe with (security_invoker = true) as
  select id, organization_id, provider, label, api_key_last4, validated_at,
         validation_error, is_active, created_by, created_at, updated_at
    from public.map_provider_credentials;

alter table public.map_provider_credentials enable row level security;

drop policy if exists tenant_isolation_map_provider_credentials_select on public.map_provider_credentials;
create policy tenant_isolation_map_provider_credentials_select on public.map_provider_credentials
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists tenant_isolation_map_provider_credentials_write on public.map_provider_credentials;
create policy tenant_isolation_map_provider_credentials_write on public.map_provider_credentials
  using (
    (organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'admin')
  )
  with check (
    (organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'admin')
  );

drop policy if exists support_write_insert on public.map_provider_credentials;
create policy support_write_insert on public.map_provider_credentials
  as restrictive for insert to authenticated
  with check (public.fn_support_write_allowed(organization_id));

drop policy if exists support_write_update on public.map_provider_credentials;
create policy support_write_update on public.map_provider_credentials
  as restrictive for update to authenticated
  using (public.fn_support_write_allowed(organization_id))
  with check (public.fn_support_write_allowed(organization_id));

drop policy if exists support_write_delete on public.map_provider_credentials;
create policy support_write_delete on public.map_provider_credentials
  as restrictive for delete to authenticated
  using (public.fn_support_write_allowed(organization_id));

-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon` do baseline
-- alcança toda tabela nova, inclusive esta — sem o revoke, a anon key (que vai
-- pro browser) tem GRANT direto nas linhas, e só a RLS (que hoje barra porque
-- `fn_user_org_ids()` é vazio sem `auth.uid()`) segura a porta.
revoke all on public.map_provider_credentials from anon;
grant select, insert, update, delete on public.map_provider_credentials to authenticated;
grant all on public.map_provider_credentials to service_role;
grant select on public.map_provider_credentials_safe to authenticated;

drop trigger if exists trg_map_provider_credentials_touch on public.map_provider_credentials;
create trigger trg_map_provider_credentials_touch
  before update on public.map_provider_credentials
  for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_map_provider_credentials_audit on public.map_provider_credentials;
create trigger trg_map_provider_credentials_audit
  after insert or delete or update on public.map_provider_credentials
  for each row execute function public.fn_audit_log_row();

comment on table public.map_provider_credentials is
  'Chave de provedor de mapa (hoje só OpenRouteService) usada pelo cálculo de distância de remoção. Mesmo molde de ai_provider_credentials.';

notify pgrst, 'reload schema';

-- ---- preço por km do produto (cálculo de orçamento de remoção) ----
--
-- DIRC: fica em `catalog_products`, não numa tabela de domínio de remoção —
-- é o mesmo conceito genérico de "preço" que `preco_cents` já é, só que por
-- distância em vez de fixo. Nulo = produto não tem componente de distância
-- (é o caso da esmagadora maioria do catálogo, que não é serviço de remoção).
alter table public.catalog_products
  add column if not exists price_per_km_cents bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_products_price_per_km_nao_negativo'
  ) then
    alter table public.catalog_products
      add constraint catalog_products_price_per_km_nao_negativo
      check (price_per_km_cents is null or price_per_km_cents >= 0);
  end if;
end $$;

notify pgrst, 'reload schema';
