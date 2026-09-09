/**
 * GET  /api/v1/maps/credentials — lista credentials de mapa da org (manager+).
 *                                  Lê da view `map_provider_credentials_safe`,
 *                                  que NUNCA expõe campos cifrados.
 * POST /api/v1/maps/credentials — cria credential (admin). Plaintext da
 *                                  api_key entra só aqui, é cifrado AES-GCM e
 *                                  descartado da memória. Validação async
 *                                  (geocodifica um endereço real) não bloqueia
 *                                  a resposta.
 *
 * Mesmo padrão de /api/v1/ai/credentials — ver `lib/maps/credenciais/guardar.ts`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { type MapProvider } from "@/lib/maps/validators";
import { guardarCredencialDeMapa } from "@/lib/maps/credenciais/guardar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, is_active, created_by, created_at, updated_at";

const MAP_PROVIDERS = ["openrouteservice"] as const;

const createSchema = z.object({
  provider: z.enum(MAP_PROVIDERS),
  label: z.string().trim().min(1).max(80),
  api_key: z.string().trim().min(8).max(2048),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "map_credentials" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("map_provider_credentials_safe")
    .select(SAFE_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });

  if (error) {
    return fail("internal_error", "Erro ao listar credentials de mapa.", 500, { requestId });
  }
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "map_credentials" });
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
  const provider = input.provider as MapProvider;

  const guardado = await guardarCredencialDeMapa({
    admin: createAdminClient(),
    orgId: activeOrg.orgId,
    userId: authUser.id,
    provider,
    label: input.label,
    apiKey: input.api_key,
    requestId,
  });

  if (!guardado.ok) {
    if (guardado.motivo === "label_em_uso") {
      return fail(
        "label_already_used",
        "Já existe uma credential de mapa com este label e provider.",
        409,
        { requestId },
      );
    }
    return fail("internal_error", "Erro ao criar credential de mapa.", 500, { requestId });
  }

  const { data: created } = await createAdminClient()
    .from("map_provider_credentials_safe")
    .select(SAFE_COLUMNS)
    .eq("id", guardado.id)
    .single();

  return ok(created, { status: 201, requestId });
}
