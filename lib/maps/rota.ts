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
 * Distância de uma rota com QUALQUER número de pontos, na ordem dada —
 * `pontos` vira uma sequência de trechos (Base→origem→destino→Base, por
 * exemplo), e o resultado já vem SOMADO pelo próprio provedor: uma só
 * chamada, não uma por trecho (mais barato de cota e evita que o total
 * some erros de arredondamento de várias respostas).
 *
 * `driving-car`: remoção é sempre por via terrestre, veículo — não há perfil
 * de pé/bicicleta que faça sentido pra ambulância.
 *
 * POST porque o GET de `/v2/directions/{profile}` só aceita 2 pontos
 * (`start`/`end`); rota de N pontos exige o corpo `coordinates`.
 */
export async function calcularDistanciaMultiTrecho(
  apiKey: string,
  pontos: readonly Coordenada[],
): Promise<DistanciaResult> {
  if (pontos.length < 2) {
    return { ok: false, error: "pontos_insuficientes" };
  }
  try {
    const url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
    const res = await timedFetch(url, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ coordinates: pontos.map((p) => [p.lon, p.lat]) }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "auth_failed_401" };
    }
    if (res.status === 404 || res.status === 400) {
      // ORS devolve 404/400 quando algum ponto não tem via rodoviária
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

/** Atalho pra rota de 2 pontos — mesma função, só sem o array na chamada. */
export function calcularDistanciaKm(
  apiKey: string,
  origem: Coordenada,
  destino: Coordenada,
): Promise<DistanciaResult> {
  return calcularDistanciaMultiTrecho(apiKey, [origem, destino]);
}
