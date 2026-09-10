/**
 * GUARDAR UMA CONEXÃO MCP EXTERNA — mesmo miolo de
 * `lib/maps/credenciais/guardar.ts`. Cifra AES-GCM, grava só os últimos 4
 * dígitos em claro, audita, valida em segundo plano contra o servidor de
 * verdade (initialize + tools/list).
 */
import { audit } from "@/lib/audit";
import { bufToBytea, encryptKey } from "@/lib/crypto/aes_gcm";
import { validarConexaoMcp } from "@/lib/mcp-cliente/validar-conexao";
import type { createAdminClient } from "@/lib/supabase/admin";

export type ResultadoDeGuardar =
  | { ok: true; id: string; last4: string }
  | { ok: false; motivo: "cifragem" | "label_em_uso" | "banco"; detalhe?: string };

export interface PedidoDeGuardar {
  admin: ReturnType<typeof createAdminClient>;
  orgId: string;
  userId: string;
  label: string;
  mcpUrl: string;
  /** Plaintext. Vive só no escopo desta chamada — nunca persistido nem logado. */
  apiKey: string;
  requestId?: string;
}

export async function guardarConexaoMcp(p: PedidoDeGuardar): Promise<ResultadoDeGuardar> {
  let encrypted;
  try {
    encrypted = encryptKey(p.apiKey);
  } catch (err) {
    return { ok: false, motivo: "cifragem", detalhe: err instanceof Error ? err.message : undefined };
  }

  const { data: created, error } = await p.admin
    .from("external_mcp_connections")
    .insert({
      organization_id: p.orgId,
      label: p.label,
      mcp_url: p.mcpUrl,
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
    action: "mcp_connection.created",
    actorUserId: p.userId,
    organizationId: p.orgId,
    resourceType: "external_mcp_connection",
    resourceId: id,
    ...(p.requestId ? { requestId: p.requestId } : {}),
    metadata: { label: p.label, mcp_url: p.mcpUrl, last4: encrypted.last4 },
  });

  void validarEmSegundoPlano(p.admin, id, p.orgId, p.mcpUrl, p.apiKey);

  return { ok: true, id, last4: encrypted.last4 };
}

async function validarEmSegundoPlano(
  admin: ReturnType<typeof createAdminClient>,
  connectionId: string,
  organizationId: string,
  mcpUrl: string,
  apiKey: string,
): Promise<void> {
  try {
    const r = await validarConexaoMcp(mcpUrl, apiKey);
    await admin
      .from("external_mcp_connections")
      .update(
        r.ok
          ? {
              validated_at: new Date().toISOString(),
              validation_error: null,
              tools_encontradas: r.ferramentas,
            }
          : { validated_at: null, validation_error: r.error },
      )
      .eq("id", connectionId)
      .eq("organization_id", organizationId);
  } catch {
    // Falha de rede na validação não derruba nada.
  }
}
