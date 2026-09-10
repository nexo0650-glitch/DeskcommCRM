/**
 * Valida (e mais tarde, chama) um servidor MCP de OUTRO sistema — a URL vem
 * de quem administra a organização, então é entrada não-confiável de
 * verdade, diferente da OpenRouteService/Anthropic (destinos fixos, escritos
 * no código). Duas defesas, nessa ordem:
 *
 * 1. **SSRF**: resolve o hostname e recusa qualquer IP privado/loopback/
 *    link-local ANTES de conectar. Sem isso, um admin (ou uma conta
 *    comprometida) usaria este campo pra fazer o servidor bater em
 *    `http://localhost:6379` (Redis), `http://waha:3000` ou qualquer coisa
 *    na rede interna da VPS — a mesma classe de ataque que a doutrina de
 *    threat-model do repo já nomeia pra outros egressos.
 *
 *    ⚠️ Isto é uma checagem PRÉ-conexão, não um proxy que resolve e ABRE a
 *    conexão no IP já resolvido — sobra uma janela TOCTOU (DNS rebinding:
 *    o hostname podia resolver público agora e privado no request de
 *    verdade um instante depois). Documentado, não fingido resolvido.
 *    Fechar de vez pediria um agente HTTP que conecta no IP pinado, escopo
 *    maior do que esta primeira versão cobre.
 *
 * 2. **Protocolo MCP de verdade**: manda `initialize` + `tools/list` via
 *    JSON-RPC contra a URL, com a chave no header `Authorization: Bearer`
 *    (mesmo contrato que ESTE sistema exige de quem conecta NELE — ver
 *    `lib/mcp/auth.ts`). "A chave válida" aqui significa "dá pra listar as
 *    ferramentas de verdade", não só "o servidor respondeu alguma coisa".
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const TIMEOUT_MS = 8000;

export interface FerramentaExterna {
  name: string;
  description?: string;
}

export type ValidacaoDeConexao =
  | { ok: true; ferramentas: FerramentaExterna[] }
  | { ok: false; error: string };

/** Faixas que nenhuma URL de sistema externo legítimo deveria resolver. */
function ipEhPrivadoOuInterno(ip: string): boolean {
  const versao = isIP(ip);
  if (versao === 4) {
    const partes = ip.split(".").map(Number);
    const [a, b] = partes;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b! >= 16 && b! <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }
  if (versao === 6) {
    const baixo = ip.toLowerCase();
    if (baixo === "::1") return true;
    if (baixo.startsWith("fe80:")) return true;
    if (baixo.startsWith("fc") || baixo.startsWith("fd")) return true; // fc00::/7 (ULA)
    return false;
  }
  return true; // não é IP válido nenhum — recusa por segurança, não libera.
}

async function urlEhSegura(urlBruta: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(urlBruta);
  } catch {
    return { ok: false, error: "url_invalida" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "url_precisa_ser_https" };
  }
  let enderecos;
  try {
    enderecos = await lookup(url.hostname, { all: true });
  } catch {
    return { ok: false, error: "dns_nao_resolveu" };
  }
  if (enderecos.length === 0 || enderecos.some((e) => ipEhPrivadoOuInterno(e.address))) {
    return { ok: false, error: "endereco_interno_recusado" };
  }
  return { ok: true };
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function validarConexaoMcp(mcpUrl: string, apiKey: string): Promise<ValidacaoDeConexao> {
  const seguranca = await urlEhSegura(mcpUrl);
  if (!seguranca.ok) return { ok: false, error: seguranca.error };

  try {
    const init = await timedFetch(mcpUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "deskcommcrm", version: "1.0" },
        },
      }),
    });
    if (init.status === 401 || init.status === 403) {
      return { ok: false, error: "chave_recusada" };
    }
    if (!init.ok) {
      return { ok: false, error: `servidor_respondeu_${init.status}` };
    }

    const listar = await timedFetch(mcpUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    if (!listar.ok) {
      return { ok: false, error: `nao_conseguiu_listar_ferramentas_${listar.status}` };
    }
    const texto = await listar.text();
    const linhaJson = texto
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("{"));
    const corpo = JSON.parse(linhaJson ?? texto) as {
      result?: { tools?: FerramentaExterna[] };
      error?: { message?: string };
    };
    if (corpo.error) {
      return { ok: false, error: corpo.error.message ?? "erro_no_protocolo_mcp" };
    }
    const ferramentas = corpo.result?.tools ?? [];
    return { ok: true, ferramentas };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : "network_error" };
  }
}
