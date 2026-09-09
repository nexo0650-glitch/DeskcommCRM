/**
 * Capacidade de REMOÇÃO — orçamento de transporte (ambulância) por distância.
 *
 * Vertical específica desta instalação, não do produto genérico: preço =
 * `catalog_products.preco_cents` (fixo da modalidade) + km rodado ×
 * `catalog_products.price_per_km_cents` (migration 0232). O km rodado NÃO é
 * só origem→destino: o veículo sai da Base (`organizations.base_address`,
 * migration 0233), então o trecho Base→origem sempre entra na conta — e,
 * numa remoção de ida e volta, o trecho de volta (destino→origem) e o
 * retorno à Base (origem→Base) entram também.
 *
 * Nunca deixa o modelo estimar distância ou preço: geocodifica os endereços
 * e calcula a rota de verdade, num único pedido de rota multi-trecho, contra
 * a OpenRouteService. Se qualquer passo falhar (sem credencial, sem base
 * cadastrada, endereço não encontrado, rota impossível), devolve um erro
 * estruturado — a mesma doutrina de `crm_search_products`, que prefere "não
 * sei" a um número inventado.
 */
import { z } from "zod";

import type { McpToolDefinition } from "../types";
import { formatCents } from "@/lib/money";
import { MapCredentialUnavailableError, loadActiveMapCredential } from "@/lib/maps/credenciais/carregar";
import { geocodeAddress, type Coordenada } from "@/lib/maps/validators";
import { calcularDistanciaMultiTrecho } from "@/lib/maps/rota";

const TIPOS_DE_VIAGEM = ["ida", "ida_e_volta"] as const;

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
  codigo_produto: z
    .string()
    .trim()
    .min(1)
    .describe(
      "O código da modalidade de remoção, como veio de crm_search_products (ex.: REMOCAO-SIMPLES). " +
        "Sempre busque o código com crm_search_products antes — nunca invente um código.",
    ),
  tipo_viagem: z
    .enum(TIPOS_DE_VIAGEM)
    .describe(
      "'ida' se o paciente só vai (o veículo sai da Base, busca, leva ao destino e volta pra Base). " +
        "'ida_e_volta' se o veículo também traz o paciente de volta ao endereço de origem antes de " +
        "voltar pra Base. Pergunte ao cliente qual é o caso — nunca assuma.",
    ),
};

interface ProdutoRemocao {
  codigo: string;
  nome: string;
  preco_cents: number;
  moeda: string;
  price_per_km_cents: number | null;
  ativo: boolean;
}

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
    "paciente ao destino, e a volta) e soma o preço fixo da modalidade com o valor por km cadastrado. " +
    "Use SEMPRE que o cliente pedir preço de remoção com endereço de origem e destino — nunca estime " +
    "distância ou valor de cabeça, preço errado é promessa que a empresa terá de cumprir ou desfazer. " +
    "Busque o código da modalidade com crm_search_products ANTES de chamar esta ferramenta, e pergunte " +
    "ao cliente se é só ida ou ida e volta. " +
    "Se voltar um erro, explique ao cliente o que falta (endereço mais completo, por exemplo) ou peça para " +
    "um humano ajudar — não responda um preço quando esta ferramenta não confirmou um.",
  inputSchema: inputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data: produto, error: erroProduto } = await ctx.supabase
      .from("catalog_products")
      .select("codigo, nome, preco_cents, moeda, price_per_km_cents, ativo")
      .eq("organization_id", ctx.organizationId)
      .eq("codigo", input.codigo_produto)
      .eq("ativo", true)
      .maybeSingle<ProdutoRemocao>();

    if (erroProduto) throw new Error(`buscar_produto_falhou: ${erroProduto.message}`);
    if (!produto) {
      return {
        erro: "produto_nao_encontrado",
        mensagem: `não há modalidade ativa com o código "${input.codigo_produto}". Busque de novo com crm_search_products.`,
      };
    }
    if (produto.price_per_km_cents == null) {
      return {
        erro: "produto_sem_preco_por_km",
        mensagem: `"${produto.nome}" não está cadastrado como modalidade cobrada por distância — peça a um humano para confirmar o preço.`,
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
    const precoDistanciaCents = Math.round(rota.distanciaKm * produto.price_per_km_cents);
    const precoTotalCents = produto.preco_cents + precoDistanciaCents;

    return {
      modalidade: produto.nome,
      codigo_produto: produto.codigo,
      tipo_viagem: input.tipo_viagem,
      base_confirmada: base.rotulo,
      origem_confirmada: origem.rotulo,
      destino_confirmado: destino.rotulo,
      distancia_km: distanciaKm,
      preco_base: formatCents(produto.preco_cents, produto.moeda),
      preco_por_km: formatCents(produto.price_per_km_cents, produto.moeda),
      preco_distancia: formatCents(precoDistanciaCents, produto.moeda),
      preco_total: formatCents(precoTotalCents, produto.moeda),
      preco_total_cents: precoTotalCents,
      mensagem:
        "A distância já inclui o trajeto do veículo (Base até o paciente" +
        (input.tipo_viagem === "ida_e_volta" ? ", ida e volta do paciente" : "") +
        " e o retorno à Base). Confirme os endereços encontrados com o cliente antes de fechar — se algum " +
        "não bater com o que ele pediu, peça o endereço de novo.",
    };
  },
};
