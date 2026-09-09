-- 0233 — endereço da base de despacho (garagem/veículo) da organização.
--
-- Usado hoje só pelo cálculo de orçamento de remoção — soma o trecho
-- Base→origem (e, em viagem de ida e volta, também origem→Base) ao trajeto
-- cobrado — mas o conceito é genérico: qualquer negócio que despacha um
-- veículo de um endereço fixo pode usar. Por isso mora em `organizations`
-- (um por org) e não numa tabela de domínio de remoção. Nullable: quem não
-- usa cálculo por distância nunca precisa preencher.
alter table public.organizations
  add column if not exists base_address text;

notify pgrst, 'reload schema';
