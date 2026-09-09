/**
 * PATCH /api/v1/admin/tenants/[id]/features
 *
 * Liga/desliga uma FUNCIONALIDADE DE VERTICAL pro tenant — hoje só
 * `remocao_ativa` (ver lib/organizacao/funcionalidades-verticais.ts). Não é
 * plano/billing (isso ainda não existe no produto): é o super-admin da
 * plataforma habilitando um recurso específico de nicho pra uma empresa do
 * ramo, na hora de configurar o cliente novo. Platform admin only.
 */
import { requireSupportWrite } from "@/lib/impersonate/support";
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";

const bodySchema = z.object({
  remocao_ativa: z.boolean(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supportDenied = await requireSupportWrite((await params).id);
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: tenantId } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return fail("validation_failed", "Invalid request body", 400, { requestId });
  }

  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, slug, display_name, settings")
    .eq("id", tenantId)
    .maybeSingle();
  if (orgError || !org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }

  const nextSettings = {
    ...((org.settings as Record<string, unknown> | null) ?? {}),
    remocao_ativa: body.remocao_ativa,
  };

  const { error: updateError } = await admin
    .from("organizations")
    .update({ settings: nextSettings, updated_at: new Date().toISOString() })
    .eq("id", tenantId);
  if (updateError) {
    return fail("internal_error", "Failed to update tenant features", 500, { requestId });
  }

  void audit({
    action: "tenant.features_updated",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: tenantId,
    resourceType: "organization",
    resourceId: tenantId,
    requestId,
    metadata: {
      tenant_id: tenantId,
      tenant_slug: org.slug,
      remocao_ativa: body.remocao_ativa,
    },
  });

  return ok({ id: tenantId, remocao_ativa: body.remocao_ativa }, { requestId });
}
