-- 0238 — provedores Groq e NVIDIA (NIM) no catálogo de modelos
--
-- A migration 0127 abriu `ai_provider_credentials.provider`/`ai_agent_versions.
-- provider` (removeu os CHECKs fixos em anthropic|openai|google) — cadastrar um
-- provedor novo não pede mais migration nenhuma NO SCHEMA. O que falta sem
-- este arquivo é só o CATÁLOGO CURADO (`ai_models`): sem uma linha aqui, a
-- tela oferece "Groq"/"NVIDIA (NIM)" no seletor (lib/ai/pontos/provedores.ts,
-- mudado no mesmo commit) e o ModelPicker some vazio — provedor cadastrável,
-- sem modelo nenhum para escolher.
--
-- IDS não verificados contra a API dos dois provedores nesta máquina (sem
-- chave de teste); seguem a convenção pública de cada um:
--   Groq   (api.groq.com/openai/v1/models)         — ids SEM prefixo de vendor
--   NVIDIA NIM (integrate.api.nvidia.com/v1/models) — ids `<vendor>/<modelo>`
-- Id errado só falha na hora da chamada, com o cliente esperando — mesmo aviso
-- da 0101/0104.
--
-- Preços em CENTAVOS por milhão de tokens. Os dois provedores são conhecidos
-- por preço baixo/gratuito; os valores abaixo são um piso conservador, não a
-- tabela oficial — reveja antes de cobrar do cliente por cima.
--
-- SEM linha em `ai_pricing` de propósito: aquela tabela é legada, servindo só
-- o worker de RAG (embeddings, sempre via OpenAI neste produto — ver
-- lib/ai/cost.ts). O custo de turno de chat lê `ai_models` direto
-- (lib/ai/runtime/cost.ts), que este apêndice já preenche.
--
-- Idempotente: `on conflict (provider, model_id) do update`.

insert into public.ai_models
  (provider, model_id, display_name, description,
   input_price_per_million_cents, output_price_per_million_cents, supports_tools)
values
  -- Groq (LPU — infraestrutura própria otimizada para velocidade de resposta)
  ('groq', 'llama-4-maverick', 'Llama 4 Maverick (Groq)',
   'O mais capaz hospedado pela Groq — resposta rápida por causa da infraestrutura deles, não do tamanho do modelo.', 50, 77, true),
  ('groq', 'llama-4-scout',    'Llama 4 Scout (Groq)',
   'Menor e mais rápido que o Maverick — bom para classificação e tarefas curtas.', 11, 34, true),
  ('groq', 'gpt-oss-120b',     'GPT-OSS 120B (Groq)',
   'Modelo aberto de raciocínio da OpenAI, hospedado na Groq.', 15, 60, true),
  ('groq', 'qwen3-32b',        'Qwen3 32B (Groq)',           null, 29, 59, true),
  -- NVIDIA NIM (catálogo amplo de modelos abertos hospedados pela própria NVIDIA)
  ('nvidia', 'nvidia/nemotron-3.5-lightning', 'Nemotron 3.5 Lightning (NVIDIA)',
   'Modelo próprio da NVIDIA, ajustado para resposta rápida.', 20, 40, true),
  ('nvidia', 'nvidia/nemotron-3-super-120b-a12b', 'Nemotron 3 Super 120B (NVIDIA)',
   'Maior da família Nemotron — mais capaz, custo mais alto.', 90, 180, true),
  ('nvidia', 'meta/llama-4-maverick-instruct', 'Llama 4 Maverick (NVIDIA NIM)',
   'O mesmo Llama 4 Maverick, hospedado pela NVIDIA em vez da Groq.', 50, 77, true),
  ('nvidia', 'deepseek-ai/deepseek-v4-flash', 'DeepSeek V4 Flash (NVIDIA NIM)', null, 27, 110, true)
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  supports_tools = excluded.supports_tools;

-- Padrão por provedor — mesmo cuidado da 0101: limpar antes de marcar, porque
-- o índice `ai_models_one_default_per_provider` é UNIQUE parcial e IMEDIATO.
update public.ai_models set is_default_for_provider = false
 where provider in ('groq', 'nvidia') and is_default_for_provider;

update public.ai_models set is_default_for_provider = true
 where (provider = 'groq'   and model_id = 'llama-4-maverick')
    or (provider = 'nvidia' and model_id = 'nvidia/nemotron-3.5-lightning');
