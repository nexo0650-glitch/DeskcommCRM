/**
 * Chama UMA ferramenta de um servidor MCP externo já conectado — o "consumo"
 * que `validar-conexao.ts` deixou como trabalho futuro na hora de shipar a
 * conexão (2026-09-10). Reusa a MESMA checagem de SSRF da validação
 * (`urlEhSegura`) e o mesmo parser tolerante a SSE (`parsearCorpoJsonRpc`).
 *
 * Nunca lança: quem chama (o turno do agente, `ferramentas-do-turno.ts`)
 * precisa de um resultado que vira `tool_result` pro modelo mesmo quando o
 * sistema externo falha — uma exceção aqui derrubaria o turno inteiro por
 * causa de um servidor de terceiro fora do ar.
 */
import { urlEhSegura } from "./validar-conexao";
import { parsearCorpoJsonRpc } from "./jsonrpc";

const TIMEOUT_MS = 15_000;

export type ResultadoDaChamada =
  | { ok: true; conteudo: unknown }
  | { ok: false; erro: string };

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function chamarFerramentaExterna(
  mcpUrl: string,
  apiKey: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ResultadoDaChamada> {
  const seguranca = await urlEhSegura(mcpUrl);
  if (!seguranca.ok) return { ok: false, erro: seguranca.error };

  try {
    const res = await timedFetch(mcpUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, erro: "chave_recusada" };
    }
    if (!res.ok) {
      return { ok: false, erro: `servidor_respondeu_${res.status}` };
    }

    const texto = await res.text();
    const corpo = parsearCorpoJsonRpc(texto) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (corpo.error) {
      return { ok: false, erro: corpo.error.message ?? "erro_no_protocolo_mcp" };
    }
    return { ok: true, conteudo: corpo.result ?? null };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.name : "network_error" };
  }
}
