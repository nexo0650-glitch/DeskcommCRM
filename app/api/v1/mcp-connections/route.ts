/**
 * GET  /api/v1/mcp-connections — lista conexões MCP externas da org (manager+).
 *                                  Lê da view `external_mcp_connections_safe`,
 *                                  que NUNCA expõe campos cifrados.
 * POST /api/v1/mcp-connections — cria conexão (admin). Plaintext da api_key
 *                                  entra só aqui, é cifrado AES-GCM e
 *                                  descartado da memória. Validação async
 *                                  (initialize + tools/list contra o
 *                                  servidor de verdade) não bloqueia a
 *                                  resposta.
 *
 * Mesmo padrão de /api/v1/maps/credentials — ver
 * `lib/mcp-cliente/credenciais/guardar.ts`.
 */
import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { guardarConexaoMcp } from "@/lib/mcp-cliente/credenciais/guardar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS =
  "id, organization_id, label, mcp_url, api_key_last4, validated_at, validation_error, tools_encontradas, is_active, created_by, created_at, updated_at";

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
  mcp_url: z.string().trim().url().startsWith("https://", "a URL precisa começar com https://"),
  api_key: z.string().trim().min(8).max(2048),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "mcp_connections" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("external_mcp_connections_safe")
    .select(SAFE_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });

  if (error) {
    return fail("internal_error", "Erro ao listar conexões MCP.", 500, { requestId });
  }
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "mcp_connections" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }

  const parsed = createSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;

  const guardado = await guardarConexaoMcp({
    admin: createAdminClient(),
    orgId: activeOrg.orgId,
    userId: authUser.id,
    label: input.label,
    mcpUrl: input.mcp_url,
    apiKey: input.api_key,
    requestId,
  });

  if (!guardado.ok) {
    if (guardado.motivo === "label_em_uso") {
      return fail("label_already_used", "Já existe uma conexão com este nome.", 409, { requestId });
    }
    return fail("internal_error", "Erro ao criar a conexão.", 500, { requestId });
  }

  const { data: created } = await createAdminClient()
    .from("external_mcp_connections_safe")
    .select(SAFE_COLUMNS)
    .eq("id", guardado.id)
    .single();

  return ok(created, { status: 201, requestId });
}
