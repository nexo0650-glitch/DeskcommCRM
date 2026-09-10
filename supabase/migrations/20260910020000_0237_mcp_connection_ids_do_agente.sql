-- 0237 — em quais conexões MCP externas este agente pode chamar ferramentas
--
-- Mesmo molde de pipeline_ids (0125) e knowledge_source_ids (0181): a coluna
-- mora na VERSÃO, porque o alcance do agente tem que ser versionado e
-- publicado junto com o resto — o runtime relê a versão publicada a cada
-- turno, e um escopo guardado fora do ciclo rascunho→publicar mudaria o
-- alcance do agente sem ninguém ter publicado nada.
--
-- Nasce fechado: default '{}' = NENHUMA conexão. Ligar é ação explícita na
-- tela, por agente — nenhum agente ganha acesso a um sistema externo (com
-- possível ESCRITA do outro lado) só porque a organização cadastrou a
-- credencial em Outros sistemas (0236).

alter table public.ai_agent_versions
  add column if not exists mcp_connection_ids uuid[] not null default '{}'::uuid[];

comment on column public.ai_agent_versions.mcp_connection_ids is
  'Conexões MCP externas (external_mcp_connections) que ESTE agente pode chamar durante a conversa. Vazio = NENHUMA: falha fechada.';

-- ---- o trigger de imutabilidade cobre a coluna nova ----
--
-- Mesmo cuidado da 0125: acrescentar a coluna sem estender o trigger deixaria
-- uma versão JÁ PUBLICADA ganhar (ou perder) acesso a um sistema externo sem
-- virar versão nova e sem deixar trilha nenhuma.
create or replace function fn_ai_agent_version_content_immutable() returns trigger
language plpgsql as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    or new.mcp_connection_ids     is distinct from old.mcp_connection_ids
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_ai_agent_versions_content_immutable on public.ai_agent_versions;
create trigger trg_ai_agent_versions_content_immutable
  before update on public.ai_agent_versions
  for each row execute function fn_ai_agent_version_content_immutable();

notify pgrst, 'reload schema';
