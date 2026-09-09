import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { COLUNAS_DO_SERVICO_REMOCAO, type ServicoRemocao } from "@/lib/schemas/servicos-remocao";
import { createClient } from "@/lib/supabase/server";

import { ServicosRemocaoClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * SERVIÇOS DE REMOÇÃO — onde o preço que `crm_calculate_removal_quote` usa é
 * cadastrado.
 *
 * Separado de Produtos (catalog_products) de propósito: o modelo de preço é
 * outro — fixo por ida/ida-e-volta abaixo de um limiar de km, por km acima
 * dele, mais uma taxa de saída única. Ver migration 0234.
 *
 * Mesmo padrão de papéis de Produtos: `viewer` vê, `manager`+ cadastra/edita.
 */
export default async function ServicosRemocaoPage() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeEditar = (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  const supabase = await createClient();
  const { data } = await supabase
    .from("remocao_servicos")
    .select(COLUNAS_DO_SERVICO_REMOCAO)
    .eq("organization_id", activeOrg.orgId)
    .order("ativo", { ascending: false })
    .order("nome")
    .limit(500);

  return (
    <ServicosRemocaoClient
      inicial={(data ?? []) as unknown as ServicoRemocao[]}
      podeEditar={podeEditar}
      textos={{
        titulo: t("Serviços de remoção"),
        subtitulo: t(
          "As modalidades de remoção (Simples, SIV, UTI...) com o preço que o agente de IA usa pra calcular orçamento.",
        ),
        vazio: t("Nenhum serviço de remoção cadastrado ainda"),
        vazioDica: t(
          "Enquanto não houver serviço cadastrado, o cálculo de orçamento de remoção não encontra a modalidade pedida.",
        ),
      }}
    />
  );
}
