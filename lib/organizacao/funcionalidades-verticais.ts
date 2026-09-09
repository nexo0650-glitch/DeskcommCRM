/**
 * FUNCIONALIDADES DE VERTICAL — LIGADAS POR ORGANIZAÇÃO, NÃO PRA TODAS.
 *
 * O produto é multi-nicho: e-commerce, clínica, imobiliária, infoproduto,
 * serviços. Algumas capacidades só fazem sentido pra UM nicho — hoje só
 * "remoção" (transporte/ambulância: catálogo próprio `remocao_servicos`,
 * tela `/app/removal-services`, tool `crm_calculate_removal_quote`). Não há
 * classificação de nicho persistida em lugar nenhum do produto de propósito
 * (o onboarding usa um rótulo transiente só pra sugerir pipeline inicial) —
 * então isto não é "qual o nicho desta org", é um interruptor SÓ pra esta
 * vertical específica, ligado manualmente pelo super-admin da plataforma
 * (`app/api/v1/admin/tenants/[id]/features/route.ts`) quando uma empresa do
 * ramo se cadastra. Toda outra org nasce sem a flag e nunca vê a tela nem a
 * tool — mesmo padrão de `empresaExigeMfa` (`lib/auth/politica-mfa.ts`):
 * ausência de chave é o valor seguro (`false`), nunca lançar.
 *
 * Generalizar isto pra um framework de "feature flags por org" antes de
 * existir uma SEGUNDA vertical que precise disso seria arquitetura pra
 * hipótese — fica documentado aqui como o ponto de partida do dia em que
 * precisar.
 */
export function remocaoAtiva(settings: unknown): boolean {
  const s = settings as { remocao_ativa?: unknown } | null | undefined;
  return s?.remocao_ativa === true;
}
