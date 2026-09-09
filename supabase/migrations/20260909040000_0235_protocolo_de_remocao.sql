-- 0235 — número de protocolo por lead (genérico de CRM, não específico de
-- remoção — DIRC: é o mesmo conceito de "número de pedido"/"número de caso"
-- que qualquer negócio no funil pode querer, cabe direto em `crm_leads`).
--
-- Usado hoje só pelo cálculo de orçamento de remoção: toda cotação COMPLETA
-- (endereços + modalidade + tipo de viagem, sem erro) vira um lead novo com
-- protocolo próprio — nunca reaproveita nem edita um protocolo existente do
-- mesmo contato, então dois pedidos seguidos da mesma pessoa (outro paciente,
-- outro dia) não se misturam.
--
-- Sequencial por organização, atribuído no INSERT por trigger — atômico via
-- UPDATE...RETURNING na própria linha da org (mesmo padrão de contador usado
-- alhures no baseline), então duas cotações completadas ao mesmo tempo nunca
-- recebem o mesmo número.
alter table public.organizations
  add column if not exists next_lead_protocol_number integer not null default 1;

alter table public.crm_leads
  add column if not exists protocol_number integer;

-- Parcial (`where ... is not null`): leads antigos sem protocolo continuam
-- coexistindo sem exigir backfill — só passam a ganhar número quando
-- recriados ou quando alguém explicitamente atribuir um.
create unique index if not exists crm_leads_org_protocol_number_key
  on public.crm_leads (organization_id, protocol_number)
  where protocol_number is not null;

-- Trigger comum (não SECURITY DEFINER): roda com o mesmo privilégio de quem
-- insere a linha, como `fn_set_updated_at` — função `returns trigger` não é
-- invocável fora de contexto de trigger, então não precisa do revoke/grant
-- que uma SECURITY DEFINER chamável por RPC precisaria.
create or replace function public.fn_assign_lead_protocol_number()
returns trigger language plpgsql as $$
declare
  v_next integer;
begin
  if new.protocol_number is not null then
    return new;
  end if;
  update public.organizations
    set next_lead_protocol_number = next_lead_protocol_number + 1
    where id = new.organization_id
    returning next_lead_protocol_number - 1 into v_next;
  new.protocol_number := v_next;
  return new;
end;
$$;

drop trigger if exists trg_assign_lead_protocol_number on public.crm_leads;
create trigger trg_assign_lead_protocol_number
  before insert on public.crm_leads
  for each row execute function public.fn_assign_lead_protocol_number();

notify pgrst, 'reload schema';
