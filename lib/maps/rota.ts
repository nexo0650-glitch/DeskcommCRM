/**
 * Distância rodoviária entre duas coordenadas via OpenRouteService Directions.
 *
 * Mesmo padrão de `validators.ts`: timeout 5s, sem retry, erro tipado — nunca
 * throw, porque quem chama (a tool MCP do agente) precisa devolver uma
 * mensagem que o modelo saiba repassar ao cliente, não uma exceção que aborta
 * o turno inteiro da conversa.
 */
import type { Coordenada } from "./validators";

const TIMEOUT_MS = 8000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export type DistanciaResult =
  | { ok: true; distanciaKm: number; duracaoMin: number }
  | { ok: false; error: string };

/**
 * `driving-car`: remoção é sempre por via terrestre, veículo — não há perfil
 * de pé/bicicleta que faça sentido pra ambulância.
 */
export async function calcularDistanciaKm(
  apiKey: string,
  origem: Coordenada,
  destino: Coordenada,
): Promise<DistanciaResult> {
  try {
    const url =
      "https://api.openrouteservice.org/v2/directions/driving-car?" +
      new URLSearchParams({
        api_key: apiKey,
        start: `${origem.lon},${origem.lat}`,
        end: `${destino.lon},${destino.lat}`,
      }).toString();
    const res = await timedFetch(url, { method: "GET" });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "auth_failed_401" };
    }
    if (res.status === 404 || res.status === 400) {
      // ORS devolve 404/400 quando um dos pontos não tem via rodoviária
      // alcançável perto (meio do oceano, endereço geocodificado errado).
      return { ok: false, error: "rota_nao_encontrada" };
    }
    if (!res.ok) {
      return { ok: false, error: `provider_status_${res.status}` };
    }
    const json = (await res.json()) as {
      features?: Array<{ properties?: { summary?: { distance?: number; duration?: number } } }>;
    };
    const resumo = json.features?.[0]?.properties?.summary;
    if (typeof resumo?.distance !== "number") {
      return { ok: false, error: "rota_nao_encontrada" };
    }
    return {
      ok: true,
      distanciaKm: resumo.distance / 1000,
      duracaoMin: (resumo.duration ?? 0) / 60,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : "network_error" };
  }
}
