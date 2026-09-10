/**
 * DELETE /api/v1/mcp-connections/:id (admin) — remove a conexão MCP externa.
 */
import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("admin", { requestId, resource: "mcp_connections" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  const admin = createAdminClient();

  const { data: conn, error: fetchErr } = await admin
    .from("external_mcp_connections")
    .select("id, organization_id, label, mcp_url")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return fail("internal_error", "Erro ao consultar conexão.", 500, { requestId });
  }
  if (!conn || conn.organization_id !== activeOrg.orgId) {
    return fail("not_found", "Conexão não encontrada.", 404, { requestId });
  }

  const { error: delErr } = await admin
    .from("external_mcp_connections")
    .delete()
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId);

  if (delErr) {
    return fail("internal_error", "Erro ao deletar conexão.", 500, { requestId });
  }

  await audit({
    action: "mcp_connection.deleted",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "external_mcp_connection",
    resourceId: id,
    requestId,
    metadata: { label: conn.label, mcp_url: conn.mcp_url },
  });

  return ok({ id, deleted: true }, { requestId });
}
