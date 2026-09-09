/**
 * Ping síncrono pra validar a chave da OpenRouteService (geocodificação —
 * usada pro cálculo de distância de remoção). Mesmo padrão de
 * `lib/ai/provider-validators.ts`: timeout 5s, sem retry, 401/403 distinto
 * de erro de rede.
 */
export interface ValidationOk {
  ok: true;
}

export interface ValidationFail {
  ok: false;
  error: string;
}

export type ValidationResult = ValidationOk | ValidationFail;

const TIMEOUT_MS = 5000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Geocodifica um endereço conhecido (Av. Paulista, São Paulo) — o mesmo
 * endpoint que o cálculo de remoção usa de verdade, então "a chave valida"
 * significa "o cálculo de distância vai funcionar", não só "a chave existe".
 */
export async function validateOpenRouteServiceKey(apiKey: string): Promise<ValidationResult> {
  try {
    const url =
      "https://api.openrouteservice.org/geocode/search?" +
      new URLSearchParams({ api_key: apiKey, text: "Avenida Paulista, São Paulo", size: "1" }).toString();
    const res = await timedFetch(url, { method: "GET" });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "auth_failed_401" };
    }
    if (!res.ok) {
      return { ok: false, error: `provider_status_${res.status}` };
    }
    const json = (await res.json()) as { features?: unknown[] };
    if (!Array.isArray(json.features) || json.features.length === 0) {
      return { ok: false, error: "sem_resultado_no_teste" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : "network_error" };
  }
}

export type MapProvider = "openrouteservice";

export function validateMapProviderKey(provider: MapProvider, apiKey: string): Promise<ValidationResult> {
  switch (provider) {
    case "openrouteservice":
      return validateOpenRouteServiceKey(apiKey);
    default:
      return Promise.resolve({ ok: false, error: `unknown_provider:${provider}` });
  }
}
