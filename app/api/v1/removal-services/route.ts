import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/removal-services — as modalidades de remoção da organização ativa.
 * POST /api/v1/removal-services — cadastra uma modalidade.
 *
 * Escrita exige `manager`: preço não se altera com papel de leitura — mesmo
 * molde de /api/v1/products.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { COLUNAS_DO_SERVICO_REMOCAO, servicoRemocaoCreateSchema } from "@/lib/schemas/servicos-remocao";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "remocao_servicos" });
  if (!authz.ok) return authz.response;

  const busca = req.nextUrl.searchParams.get("busca")?.trim() ?? "";
  const supabase = await createClient();

  let q = supabase
    .from("remocao_servicos")
    .select(COLUNAS_DO_SERVICO_REMOCAO)
    .eq("organization_id", authz.org.orgId);

  if (busca !== "") q = q.or(`nome.ilike.%${busca}%,codigo.ilike.%${busca}%`);

  const { data, error } = await q.order("ativo", { ascending: false }).order("nome").limit(500);

  if (error) return fail("internal_error", "Erro ao listar os serviços.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "remocao_servicos" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = servicoRemocaoCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const moeda = await moedaDaOrganizacao(supabase, authz.org.orgId);
  const { data, error } = await supabase
    .from("remocao_servicos")
    .insert({ ...parsed.data, moeda, organization_id: authz.org.orgId })
    .select(COLUNAS_DO_SERVICO_REMOCAO)
    .single();

  if (error) {
    if (error.code === "23505") {
      return fail("conflict", t("Já existe um serviço com esse código."), 409, { requestId });
    }
    return fail("internal_error", "Erro ao salvar o serviço.", 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "removal_service.created",
    resourceType: "remocao_servicos",
    resourceId: (data as unknown as { id: string }).id,
    requestId,
  });

  return ok(data, { requestId, status: 201 });
}
