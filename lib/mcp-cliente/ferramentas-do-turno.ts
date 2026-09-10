/**
 * Ferramentas de conexões MCP EXTERNAS montadas no turno do agente — o
 * "consumo" que faltava depois de guardar+validar a conexão (2026-09-10, ver
 * `validar-conexao.ts`). Chamada por `lib/agent-engine/edge/crm/mcp-tools.ts`
 * (`buildMcpTurnTools`), que mescla o resultado no mesmo `ToolSet` das
 * ferramentas do catálogo interno.
 *
 * Espelha `lib/ai/runtime/tools.ts` (`wrapMcpTool`) na FORMA — nunca lança,
 * sempre audita, devolve `{ error }` pro modelo em vez de derrubar o turno —
 * mas a ferramenta em si é outra coisa: não tem handler local nem
 * `inputSchema` Zod. O schema é o que o SERVIDOR EXTERNO devolveu em
 * `tools/list` (JSON Schema cru, guardado em
 * `external_mcp_connections.tools_encontradas`), e a execução é uma chamada
 * HTTP de verdade pra fora, não uma query neste banco.
 *
 * Escopo desta v1, deliberado: só o Conversador ganha estas ferramentas — o
 * papel Operador (`operator_tool_ids`) tem seu PRÓPRIO catálogo, independente
 * do Conversador desde a spec 16 §3.2, e estender o mesmo isolamento pra cá é
 * a decisão consistente (ver o `mcpConnectionIds: []` explícito na chamada do
 * turno do Operador). Ligar o Operador a sistemas externos é trabalho futuro,
 * não uma omissão.
 */
import { dynamicTool, jsonSchema, type JSONSchema7, type Tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { auditMcpToolCall } from "@/lib/mcp/audit";
import type { McpContext } from "@/lib/mcp/types";
import { byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";
import { chamarFerramentaExterna } from "./chamar-ferramenta";
import type { FerramentaExterna } from "./validar-conexao";

interface ConexaoRow {
  id: string;
  label: string;
  mcp_url: string;
  api_key_encrypted: unknown;
  api_key_iv: unknown;
  api_key_tag: unknown;
  tools_encontradas: FerramentaExterna[] | null;
}

/**
 * Teto POR CONEXÃO, não do turno inteiro — um servidor externo com um
 * catálogo enorme não deveria conseguir sozinho estourar o orçamento de
 * ferramentas do agente. Deliberadamente separado do `TETO_TOOLS_POR_AGENTE`
 * do catálogo interno (`lib/mcp/tools/selecao-por-pacote.ts`): aquele é
 * validação de TELA sobre `tool_ids`, este é uma cerca de RUNTIME sobre um
 * catálogo que a organização não controla e pode mudar a qualquer momento do
 * lado de lá.
 */
const TETO_FERRAMENTAS_POR_CONEXAO = 15;

/** Nome de tool válido pro provider (letras/dígitos/`_`/`-`), sempre <= 64 chars. */
function slugify(s: string): string {
  const limpo = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return limpo === "" ? "conexao" : limpo.slice(0, 24);
}

/**
 * `ext__<slug-da-conexão>_<8-chars-do-id>__<nome-da-ferramenta>`.
 *
 * O sufixo de 8 chars do id evita colisão entre duas conexões com o mesmo
 * rótulo (rótulo é único só DENTRO de uma conexão, não entre conexões — e
 * nada impede duas orgs, ou a mesma org duas vezes, de chamar "Estoque").
 */
function nomeDaFerramenta(connLabel: string, connId: string, toolName: string): string {
  const prefixo = `ext__${slugify(connLabel)}_${connId.replace(/-/g, "").slice(0, 8)}__`;
  const restante = Math.max(64 - prefixo.length, 8);
  const nomeLimpo = toolName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, restante);
  return `${prefixo}${nomeLimpo}`;
}

export interface ExternalMcpTurnTools {
  tools: Record<string, Tool>;
  toolIds: string[];
}

export async function buildExternalMcpTurnTools(
  supabase: SupabaseClient,
  ctx: McpContext,
  connectionIds: readonly string[],
  options?: { readOnly?: boolean },
): Promise<ExternalMcpTurnTools> {
  if (connectionIds.length === 0) return { tools: {}, toolIds: [] };

  // Sempre RELÊ do banco (nunca confia em cache do agentConfig): a conexão
  // pode ter sido desativada, excluída ou re-testada com falha desde a
  // última publicação da versão, e o escopo tem que refletir o estado atual
  // da credencial, não uma fotografia de quando o agente foi publicado.
  const { data, error } = await supabase
    .from("external_mcp_connections")
    .select("id, label, mcp_url, api_key_encrypted, api_key_iv, api_key_tag, tools_encontradas")
    .eq("organization_id", ctx.organizationId)
    .eq("is_active", true)
    .not("validated_at", "is", null)
    .in("id", connectionIds as string[]);

  if (error || !data) return { tools: {}, toolIds: [] };

  const tools: Record<string, Tool> = {};

  for (const row of data as unknown as ConexaoRow[]) {
    let apiKey: string;
    try {
      apiKey = decryptKey({
        ciphertext: byteaToBuffer(row.api_key_encrypted),
        iv: byteaToBuffer(row.api_key_iv),
        tag: byteaToBuffer(row.api_key_tag),
      });
    } catch {
      // Chave ilegível (rotação de AI_CRED_AES_KEY, corrupção) — pula esta
      // conexão, não derruba o turno por causa de uma credencial.
      continue;
    }

    const ferramentas = (row.tools_encontradas ?? []).slice(0, TETO_FERRAMENTAS_POR_CONEXAO);

    for (const f of ferramentas) {
      if (!f.name) continue;
      const nome = nomeDaFerramenta(row.label, row.id, f.name);
      if (tools[nome]) continue; // colisão — a primeira conexão na lista vence

      const schemaCru: JSONSchema7 =
        f.inputSchema && typeof f.inputSchema === "object"
          ? (f.inputSchema as JSONSchema7)
          : { type: "object", properties: {} };

      // `dynamicTool`, não `tool`: é o helper que o próprio SDK documenta pra
      // "MCP tools that are not known at development time" — exatamente este
      // caso, schema vindo de um `tools/list` de outro processo.
      tools[nome] = dynamicTool({
        description: `[${row.label}] ${f.description ?? f.name}`.slice(0, 1024),
        inputSchema: jsonSchema(schemaCru),
        execute: async (args: unknown) => {
          const startedAt = Date.now();
          const argsRecord = (args ?? {}) as Record<string, unknown>;

          if (options?.readOnly) {
            // Modo teste/preview: nunca chama o sistema externo de verdade —
            // um clique de "testar agente" na tela não pode ter efeito num
            // sistema que pertence a outra organização.
            return {
              preview: true,
              mensagem:
                "Chamada desativada durante o teste do agente — em produção, isto chamaria o sistema externo de verdade.",
            };
          }

          const resultado = await chamarFerramentaExterna(row.mcp_url, apiKey, f.name, argsRecord);

          void auditMcpToolCall({
            ctx,
            toolName: nome,
            args: argsRecord,
            durationMs: Date.now() - startedAt,
            success: resultado.ok,
            errorMessage: resultado.ok ? undefined : resultado.erro,
          });

          if (!resultado.ok) return { error: resultado.erro };
          return resultado.conteudo;
        },
      });
    }
  }

  return { tools, toolIds: Object.keys(tools) };
}
