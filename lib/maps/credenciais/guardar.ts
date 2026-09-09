/**
 * GUARDAR A CHAVE DE UM PROVEDOR DE MAPA — mesmo miolo de
 * `lib/ai/credenciais/guardar.ts`, adaptado pra `map_provider_credentials`.
 * Cifra AES-GCM, grava só os últimos 4 dígitos em claro, audita, valida em
 * segundo plano contra o provedor de verdade (geocodifica um endereço real).
 */
import { audit } from "@/lib/audit";
import { bufToBytea, encryptKey } from "@/lib/crypto/aes_gcm";
import { validateMapProviderKey, type MapProvider } from "@/lib/maps/validators";
import type { createAdminClient } from "@/lib/supabase/admin";

export type ResultadoDeGuardar =
  | { ok: true; id: string; last4: string }
  | { ok: false; motivo: "cifragem" | "label_em_uso" | "banco"; detalhe?: string };

export interface PedidoDeGuardar {
  admin: ReturnType<typeof createAdminClient>;
  orgId: string;
  userId: string;
  provider: MapProvider;
  label: string;
  /** Plaintext. Vive só no escopo desta chamada — nunca persistido nem logado. */
  apiKey: string;
  requestId?: string;
}

export async function guardarCredencialDeMapa(p: PedidoDeGuardar): Promise<ResultadoDeGuardar> {
  let encrypted;
  try {
    encrypted = encryptKey(p.apiKey);
  } catch (err) {
    return { ok: false, motivo: "cifragem", detalhe: err instanceof Error ? err.message : undefined };
  }

  const { data: created, error } = await p.admin
    .from("map_provider_credentials")
    .insert({
      organization_id: p.orgId,
      provider: p.provider,
      label: p.label,
      api_key_encrypted: bufToBytea(encrypted.ciphertext),
      api_key_iv: bufToBytea(encrypted.iv),
      api_key_tag: bufToBytea(encrypted.tag),
      api_key_last4: encrypted.last4,
      is_active: true,
      created_by: p.userId,
    })
    .select("id")
    .single();

  if (error || !created) {
    if (error?.code === "23505") return { ok: false, motivo: "label_em_uso" };
    return { ok: false, motivo: "banco", detalhe: error?.message };
  }

  const id = created.id as string;

  await audit({
    action: "maps.credential_created",
    actorUserId: p.userId,
    organizationId: p.orgId,
    resourceType: "map_provider_credential",
    resourceId: id,
    ...(p.requestId ? { requestId: p.requestId } : {}),
    metadata: { provider: p.provider, label: p.label, last4: encrypted.last4 },
  });

  // Fire-and-forget: a validação geocodifica um endereço real contra a API —
  // é o consumidor mínimo que prova a chave funciona, não é só "existe".
  void validarEmSegundoPlano(p.admin, id, p.orgId, p.provider, p.apiKey);

  return { ok: true, id, last4: encrypted.last4 };
}

async function validarEmSegundoPlano(
  admin: ReturnType<typeof createAdminClient>,
  credentialId: string,
  organizationId: string,
  provider: MapProvider,
  apiKey: string,
): Promise<void> {
  try {
    const r = await validateMapProviderKey(provider, apiKey);
    await admin
      .from("map_provider_credentials")
      .update(
        r.ok
          ? { validated_at: new Date().toISOString(), validation_error: null }
          : { validated_at: null, validation_error: r.error },
      )
      .eq("id", credentialId)
      .eq("organization_id", organizationId);
  } catch {
    // Falha de rede na validação não derruba nada: validated_at continua
    // nulo, que é a leitura honesta de "ainda não sei".
  }
}
