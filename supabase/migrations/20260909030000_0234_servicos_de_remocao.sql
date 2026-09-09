-- 0234 — catálogo próprio de SERVIÇOS de remoção (Simples/SIV/UTI, ...),
-- separado do catálogo genérico de produtos (`catalog_products`).
--
-- Por que tabela nova e não mais colunas em `catalog_products`: o modelo de
-- preço de remoção não é "preço fixo + opcional por km" (isso já existia,
-- migration 0232) — é "preço fixo (ida OU ida-e-volta) OU por km, dependendo
-- de um limiar de distância, mais uma taxa de saída única por chamada".
-- Bolar isso em cima de `preco_cents`/`price_per_km_cents` faria a tabela
-- genérica carregar 3 colunas que só remoção usa, e o resto do catálogo
-- (que não tem "ida e volta" nem "taxa de saída") ficaria com colunas
-- eternamente nulas. DIRC: é vocabulário de negócio diferente, tabela
-- diferente — mas mora perto (mesma doutrina de `organization_id`, RLS,
-- índice por código, revoke de anon), só que com seu próprio dono.
create table if not exists public.remocao_servicos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  codigo text not null,
  nome text not null,
  descricao text,

  -- Preço fixo, usado quando a distância do trajeto fica ABAIXO do limiar —
  -- a partir do limiar, o preço passa a ser por km (ver valor_km_cents) e
  -- estes dois campos saem da conta.
  valor_ida_cents bigint not null,
  valor_ida_e_volta_cents bigint not null,

  -- Cobrada uma vez por chamada, sempre — entra tanto no modo fixo quanto no
  -- modo por km.
  taxa_saida_cents bigint not null default 0,

  -- Preço por km, usado quando a distância do trajeto fica NO limiar ou acima.
  valor_km_cents bigint not null,
  -- Em km. Fracionário (ex.: 12.5) porque a distância calculada também é.
  limiar_km numeric(6,1) not null,

  moeda text not null default 'BRL',
  ativo boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint remocao_servicos_valor_ida_nao_negativo check (valor_ida_cents >= 0),
  constraint remocao_servicos_valor_ida_volta_nao_negativo check (valor_ida_e_volta_cents >= 0),
  constraint remocao_servicos_taxa_saida_nao_negativa check (taxa_saida_cents >= 0),
  constraint remocao_servicos_valor_km_nao_negativo check (valor_km_cents >= 0),
  constraint remocao_servicos_limiar_km_nao_negativo check (limiar_km >= 0),
  constraint remocao_servicos_moeda_iso check (moeda ~ '^[A-Z]{3}$')
);

create unique index if not exists remocao_servicos_org_codigo_key
  on public.remocao_servicos (organization_id, codigo);

create index if not exists remocao_servicos_org_ativos_idx
  on public.remocao_servicos (organization_id, ativo, nome);

alter table public.remocao_servicos enable row level security;

-- Mesmo molde de catalog_products (0204): leitura da org inteira, escrita só
-- manager+ — preço de venda não se altera com papel de leitura.
drop policy if exists remocao_servicos_select on public.remocao_servicos;
create policy remocao_servicos_select on public.remocao_servicos
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

drop policy if exists remocao_servicos_write on public.remocao_servicos;
create policy remocao_servicos_write on public.remocao_servicos
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- Nomes GENÉRICOS de propósito (não `remocao_servicos_support_write_*`): a
-- varredura dinâmica do baseline (perto da "VARREDURA anon") recria policies
-- com esses 3 nomes exatos em toda tabela tenant-writable que encontrar a
-- cada apply — nomear diferente faz sobrar 6 policies em vez de 3 na segunda
-- passada (install+update), e um invariante de CI reprova. Lição paga em
-- 0232 (map_provider_credentials), registrada em memória de sessão.
drop policy if exists support_write_insert on public.remocao_servicos;
create policy support_write_insert on public.remocao_servicos
  as restrictive for insert to authenticated
  with check (public.fn_support_write_allowed(organization_id));

drop policy if exists support_write_update on public.remocao_servicos;
create policy support_write_update on public.remocao_servicos
  as restrictive for update to authenticated
  using (public.fn_support_write_allowed(organization_id))
  with check (public.fn_support_write_allowed(organization_id));

drop policy if exists support_write_delete on public.remocao_servicos;
create policy support_write_delete on public.remocao_servicos
  as restrictive for delete to authenticated
  using (public.fn_support_write_allowed(organization_id));

revoke all on public.remocao_servicos from anon;
grant select, insert, update, delete on public.remocao_servicos to authenticated;
grant all on public.remocao_servicos to service_role;

drop trigger if exists trg_remocao_servicos_updated_at on public.remocao_servicos;
create trigger trg_remocao_servicos_updated_at
  before update on public.remocao_servicos
  for each row execute function public.fn_set_updated_at();

comment on table public.remocao_servicos is
  'Modalidades de remoção (Simples/SIV/UTI, ...): preço fixo por ida/ida-e-volta + taxa de saída única, ou preço por km acima do limiar. Sucessora das linhas equivalentes que existiam em catalog_products (migration 0232).';

notify pgrst, 'reload schema';
