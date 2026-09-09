/**
 * Decrypt just-in-time de `map_provider_credentials` — mesmo molde de
 * `lib/ai/credentials.ts`. Usada pela tool MCP de orçamento de remoção.
 *
 * Diferença deliberada: lá o caller já tem o `id` (veio da configuração do
 * agente); aqui não — a tool recebe só `organizationId`, porque hoje só existe
 * UM provedor de mapa por instalação. Pega a credencial ATIVA mais recente
 * da org para o provider; se um dia houver mais de um provider vivo ao mesmo
 * tempo, isto precisa de um seletor explícito (não adivinhar qual usar).
 */
import { byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";
import { createAdminClient } from "@/lib/supabase/admin";

import type { MapProvider } from "../validators";

export interface LoadedMapCredential {
  apiKey: string;
  provider: MapProvider;
  label: string;
}

export class MapCredentialUnavailableError extends Error {
  constructor(
    public readonly reason: "not_found" | "not_validated" | "decrypt_failed",
    message: string,
  ) {
    super(message);
    this.name = "MapCredentialUnavailableError";
  }
}

interface CredentialRow {
  id: string;
  provider: MapProvider;
  label: string;
  api_key_encrypted: unknown;
  api_key_iv: unknown;
  api_key_tag: unknown;
  validated_at: string | null;
}

export async function loadActiveMapCredential(
  organizationId: string,
  provider: MapProvider,
): Promise<LoadedMapCredential> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("map_provider_credentials")
    .select("id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, validated_at")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<CredentialRow>();

  if (error || !data) {
    throw new MapCredentialUnavailableError(
      "not_found",
      error ? `query_error: ${error.message}` : "nenhuma credencial de mapa ativa para esta organização",
    );
  }
  if (!data.validated_at) {
    throw new MapCredentialUnavailableError(
      "not_validated",
      "credencial de mapa ainda não validada com o provedor",
    );
  }

  try {
    const apiKey = decryptKey({
      ciphertext: byteaToBuffer(data.api_key_encrypted),
      iv: byteaToBuffer(data.api_key_iv),
      tag: byteaToBuffer(data.api_key_tag),
    });
    return { apiKey, provider: data.provider, label: data.label };
  } catch (err) {
    throw new MapCredentialUnavailableError(
      "decrypt_failed",
      err instanceof Error ? err.message : "decrypt_failed",
    );
  }
}
