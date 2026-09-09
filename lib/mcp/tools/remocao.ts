/**
 * Capacidade de REMOÇÃO — modalidades e orçamento de transporte (ambulância).
 *
 * Vertical específica desta instalação: catálogo próprio (`remocao_servicos`,
 * migration 0234), separado do produto genérico. Preço:
 *
 *   - distância do trajeto < limiar_km  → taxa_saida + (valor_ida OU valor_ida_e_volta)
 *   - distância do trajeto >= limiar_km → taxa_saida + (distância × valor_km)
 *
 * O trajeto em si (Base→origem→destino→..., ver `trajetoDaViagem`) é sempre
 * calculado de verdade contra a OpenRouteService — é o que decide qual dos
 * dois ramos da fórmula vale, então nunca pode ser estimado.
 *
 * Nunca deixa o modelo estimar distância ou preço: se qualquer passo falhar
 * (sem credencial, sem base cadastrada, endereço não encontrado, rota
 * impossível), devolve um erro estruturado — a mesma doutrina de
 * `crm_search_products`, que prefere "não sei" a um número inventado.
 */
import { z } from "zod";

import type { McpToolDefinition } from "../types";
import { formatCents } from "@/lib/money";
import { MapCredentialUnavailableError, loadActiveMapCredential } from "@/lib/maps/credenciais/carregar";
import { geocodeAddress, type Coordenada } from "@/lib/maps/validators";
import { calcularDistanciaMultiTrecho } from "@/lib/maps/rota";

const TIPOS_DE_VIAGEM = ["ida", "ida_e_volta"] as const;

interface ServicoRemocao {
  codigo: string;
  nome: string;
  valor_ida_cents: number;
  valor_ida_e_volta_cents: number;
  taxa_saida_cents: number;
  valor_km_cents: number;
  limiar_km: number;
  moeda: string;
  ativo: boolean;
}

const SELECT_SERVICO =
  "codigo, nome, valor_ida_cents, valor_ida_e_volta_cents, taxa_saida_cents, valor_km_cents, limiar_km, moeda, ativo";

// ---------------------------------------------------------------------------
// listar modalidades
// ---------------------------------------------------------------------------

const listServicosInputShape = {};

export const crmListRemovalServices: McpToolDefinition<typeof listServicosInputShape> = {
  name: "crm_list_removal_services",
  description:
    "Lista as modalidades de remoção cadastradas (ex.: Simples, SIV, UTI), com o código de cada uma. Use " +
    "ANTES de crm_calculate_removal_quote pra saber qual código passar — nunca invente um código de " +
    "modalidade.",
  inputSchema: listServicosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (_input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("remocao_servicos")
      .select(SELECT_SERVICO)
      .eq("organization_id", ctx.organizationId)
      .eq("ativo", true)
      .order("nome")
      .limit(50);

    if (error) throw new Error(`listar_servicos_de_remocao_falhou: ${error.message}`);
    const servicos = (data ?? []) as unknown as ServicoRemocao[];

    if (servicos.length === 0) {
      return {
        servicos: [],
        mensagem: "não há nenhuma modalidade de remoção cadastrada — peça a um humano para confirmar o orçamento.",
      };
    }

    return {
      servicos: servicos.map((s) => ({
        codigo: s.codigo,
        nome: s.nome,
        valor_ida: formatCents(s.valor_ida_cents, s.moeda),
        valor_ida_e_volta: formatCents(s.valor_ida_e_volta_cents, s.moeda),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// calcular orçamento
// ---------------------------------------------------------------------------

const inputShape = {
  endereco_origem: z
    .string()
    .trim()
    .min(5)
    .describe("Endereço completo de onde o veículo vai buscar o paciente (rua, número, bairro, cidade)."),
  endereco_destino: z
    .string()
    .trim()
    .min(5)
    .describe("Endereço completo de destino da remoção (rua, número, bairro, cidade)."),
  codigo_servico: z
    .string()
    .trim()
    .min(1)
    .describe(
      "O código da modalidade de remoção, como veio de crm_list_removal_services (ex.: REMOCAO-SIMPLES). " +
        "Sempre busque o código com crm_list_removal_services antes — nunca invente um código.",
    ),
  tipo_viagem: z
    .enum(TIPOS_DE_VIAGEM)
    .describe(
      "'ida' se o paciente só vai (o veículo sai da Base, busca, leva ao destino e volta pra Base). " +
        "'ida_e_volta' se o veículo também traz o paciente de volta ao endereço de origem antes de " +
        "voltar pra Base. Pergunte ao cliente qual é o caso — nunca assuma.",
    ),
};

/** Monta a sequência de trechos na ordem que o veículo realmente percorre. */
function trajetoDaViagem(
  tipo: (typeof TIPOS_DE_VIAGEM)[number],
  base: Coordenada,
  origem: Coordenada,
  destino: Coordenada,
): Coordenada[] {
  return tipo === "ida_e_volta"
    ? [base, origem, destino, origem, base]
    : [base, origem, destino, base];
}

export const crmCalculateRemovalQuote: McpToolDefinition<typeof inputShape> = {
  name: "crm_calculate_removal_quote",
  description:
    "Calcula o ORÇAMENTO EXATO de uma remoção: geocodifica a Base da empresa e os endereços de origem e " +
    "destino, calcula a distância rodoviária de verdade do trajeto completo (Base até o paciente, do " +
    "paciente ao destino, e a volta) e aplica a regra de preço da modalidade — valor fixo de ida/ida-e-volta " +
    "abaixo do limiar de km cadastrado, ou valor por km a partir dele, mais a taxa de saída. " +
    "Use SEMPRE que o cliente pedir preço de remoção com endereço de origem e destino — nunca estime " +
    "distância ou valor de cabeça, preço errado é promessa que a empresa terá de cumprir ou desfazer. " +
    "Busque o código da modalidade com crm_list_removal_services ANTES de chamar esta ferramenta, e " +
    "pergunte ao cliente se é só ida ou ida e volta. " +
    "Se voltar um erro, explique ao cliente o que falta (endereço mais completo, por exemplo) ou peça para " +
    "um humano ajudar — não responda um preço quando esta ferramenta não confirmou um.",
  inputSchema: inputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data: servico, error: erroServico } = await ctx.supabase
      .from("remocao_servicos")
      .select(SELECT_SERVICO)
      .eq("organization_id", ctx.organizationId)
      .eq("codigo", input.codigo_servico)
      .eq("ativo", true)
      .maybeSingle<ServicoRemocao>();

    if (erroServico) throw new Error(`buscar_servico_de_remocao_falhou: ${erroServico.message}`);
    if (!servico) {
      return {
        erro: "servico_nao_encontrado",
        mensagem: `não há modalidade ativa com o código "${input.codigo_servico}". Busque de novo com crm_list_removal_services.`,
      };
    }

    const { data: org, error: erroOrg } = await ctx.supabase
      .from("organizations")
      .select("base_address")
      .eq("id", ctx.organizationId)
      .maybeSingle<{ base_address: string | null }>();
    if (erroOrg) throw new Error(`buscar_organizacao_falhou: ${erroOrg.message}`);
    if (!org?.base_address || org.base_address.trim() === "") {
      return {
        erro: "sem_endereco_de_base",
        mensagem:
          "esta empresa ainda não cadastrou o endereço da Base (de onde o veículo sai) — peça a um humano " +
          "para configurar em Configurações › Organização antes de fechar orçamento.",
      };
    }

    let credencial;
    try {
      credencial = await loadActiveMapCredential(ctx.organizationId, "openrouteservice");
    } catch (err) {
      if (err instanceof MapCredentialUnavailableError) {
        return {
          erro: "sem_credencial_de_mapa",
          mensagem:
            err.reason === "not_validated"
              ? "a chave de mapa desta empresa ainda não foi validada — peça a um humano para confirmar o orçamento."
              : "esta empresa ainda não configurou a chave de mapa — peça a um humano para calcular e confirmar o orçamento.",
        };
      }
      throw err;
    }

    const [base, origem, destino] = await Promise.all([
      geocodeAddress(credencial.apiKey, org.base_address),
      geocodeAddress(credencial.apiKey, input.endereco_origem),
      geocodeAddress(credencial.apiKey, input.endereco_destino),
    ]);

    if (!base.ok) {
      return {
        erro: "endereco_nao_encontrado",
        campo: "base",
        mensagem:
          "não encontrei o endereço da Base cadastrado pela empresa. Peça a um humano para corrigir em " +
          "Configurações › Organização.",
      };
    }
    if (!origem.ok) {
      return {
        erro: "endereco_nao_encontrado",
        campo: "origem",
        mensagem: `não encontrei o endereço de origem "${input.endereco_origem}". Peça um endereço mais completo (rua, número, cidade).`,
      };
    }
    if (!destino.ok) {
      return {
        erro: "endereco_nao_encontrado",
        campo: "destino",
        mensagem: `não encontrei o endereço de destino "${input.endereco_destino}". Peça um endereço mais completo (rua, número, cidade).`,
      };
    }

    const trajeto = trajetoDaViagem(input.tipo_viagem, base.coordenada, origem.coordenada, destino.coordenada);
    const rota = await calcularDistanciaMultiTrecho(credencial.apiKey, trajeto);
    if (!rota.ok) {
      return {
        erro: "rota_nao_calculada",
        mensagem: "não consegui calcular a rota completa entre esses endereços. Peça a um humano para confirmar o orçamento.",
      };
    }

    const distanciaKm = Math.round(rota.distanciaKm * 10) / 10;
    const porKm = rota.distanciaKm >= servico.limiar_km;
    const valorFixoCents = input.tipo_viagem === "ida_e_volta" ? servico.valor_ida_e_volta_cents : servico.valor_ida_cents;
    const componenteCents = porKm ? Math.round(rota.distanciaKm * servico.valor_km_cents) : valorFixoCents;
    const precoTotalCents = servico.taxa_saida_cents + componenteCents;

    return {
      modalidade: servico.nome,
      codigo_servico: servico.codigo,
      tipo_viagem: input.tipo_viagem,
      base_confirmada: base.rotulo,
      origem_confirmada: origem.rotulo,
      destino_confirmado: destino.rotulo,
      distancia_km: distanciaKm,
      modo_de_calculo: porKm ? "por_km" : "valor_fixo",
      taxa_saida: formatCents(servico.taxa_saida_cents, servico.moeda),
      ...(porKm
        ? { valor_por_km: formatCents(servico.valor_km_cents, servico.moeda) }
        : {
            valor_fixo_usado:
              input.tipo_viagem === "ida_e_volta" ? "ida e volta" : "ida",
            valor_fixo: formatCents(valorFixoCents, servico.moeda),
          }),
      preco_total: formatCents(precoTotalCents, servico.moeda),
      preco_total_cents: precoTotalCents,
      mensagem:
        "A distância já inclui o trajeto do veículo (Base até o paciente" +
        (input.tipo_viagem === "ida_e_volta" ? ", ida e volta do paciente" : "") +
        " e o retorno à Base). Confirme os endereços encontrados com o cliente antes de fechar — se algum " +
        "não bater com o que ele pediu, peça o endereço de novo.",
    };
  },
};
