/**
 * Capacidade de REMOÇÃO — orçamento de transporte (ambulância) por distância.
 *
 * Vertical específica desta instalação, não do produto genérico: preço =
 * `catalog_products.preco_cents` (fixo da modalidade) + km rodado entre
 * origem e destino × `catalog_products.price_per_km_cents`. As duas colunas
 * já existem no catálogo comum (migration 0232) — nenhuma tabela nova de
 * domínio, é DIRC puro.
 *
 * Nunca deixa o modelo estimar distância ou preço: geocodifica os dois
 * endereços e calcula a rota de verdade contra a OpenRouteService. Se
 * qualquer passo falhar (sem credencial, endereço não encontrado, rota
 * impossível), devolve um erro estruturado — a mesma doutrina de
 * `crm_search_products`, que prefere "não sei" a um número inventado.
 */
import { z } from "zod";

import type { McpToolDefinition } from "../types";
import { formatCents } from "@/lib/money";
import { MapCredentialUnavailableError, loadActiveMapCredential } from "@/lib/maps/credenciais/carregar";
import { geocodeAddress } from "@/lib/maps/validators";
import { calcularDistanciaKm } from "@/lib/maps/rota";

const inputShape = {
  endereco_origem: z
    .string()
    .trim()
    .min(5)
    .describe("Endereço completo de onde o veículo sai buscar o paciente (rua, número, bairro, cidade)."),
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
};

interface ProdutoRemocao {
  codigo: string;
  nome: string;
  preco_cents: number;
  moeda: string;
  price_per_km_cents: number | null;
  ativo: boolean;
}

export const crmCalculateRemovalQuote: McpToolDefinition<typeof inputShape> = {
  name: "crm_calculate_removal_quote",
  description:
    "Calcula o ORÇAMENTO EXATO de uma remoção: geocodifica origem e destino, calcula a distância rodoviária " +
    "de verdade e soma o preço fixo da modalidade com o valor por km cadastrado. Use SEMPRE que o cliente " +
    "pedir preço de remoção com endereço de origem e destino — nunca estime distância ou valor de cabeça, " +
    "peça errado é promessa que a empresa terá de cumprir ou desfazer. " +
    "Busque o código da modalidade com crm_search_products ANTES de chamar esta ferramenta. " +
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

    const [origem, destino] = await Promise.all([
      geocodeAddress(credencial.apiKey, input.endereco_origem),
      geocodeAddress(credencial.apiKey, input.endereco_destino),
    ]);

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

    const rota = await calcularDistanciaKm(credencial.apiKey, origem.coordenada, destino.coordenada);
    if (!rota.ok) {
      return {
        erro: "rota_nao_calculada",
        mensagem: "não consegui calcular a rota entre esses dois endereços. Peça a um humano para confirmar o orçamento.",
      };
    }

    const distanciaKm = Math.round(rota.distanciaKm * 10) / 10;
    const precoDistanciaCents = Math.round(rota.distanciaKm * produto.price_per_km_cents);
    const precoTotalCents = produto.preco_cents + precoDistanciaCents;

    return {
      modalidade: produto.nome,
      codigo_produto: produto.codigo,
      origem_confirmada: origem.rotulo,
      destino_confirmado: destino.rotulo,
      distancia_km: distanciaKm,
      preco_base: formatCents(produto.preco_cents, produto.moeda),
      preco_por_km: formatCents(produto.price_per_km_cents, produto.moeda),
      preco_distancia: formatCents(precoDistanciaCents, produto.moeda),
      preco_total: formatCents(precoTotalCents, produto.moeda),
      preco_total_cents: precoTotalCents,
      mensagem:
        "Confirme os dois endereços encontrados com o cliente antes de fechar — se um deles não bate com o que ele pediu, peça o endereço de novo.",
    };
  },
};
