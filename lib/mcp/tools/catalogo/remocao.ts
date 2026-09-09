/**
 * Capacidade de REMOÇÃO — orçamento de transporte por distância.
 *
 * Vertical desta instalação (transporte/ambulância), não do produto genérico.
 * O texto que vai ao MODELO é a `description` do handler
 * (`lib/mcp/tools/remocao.ts`); aqui é só a camada de apresentação pro
 * humano que configura o agente.
 */
import { declararTools } from "./tipos";

export const TOOLS_REMOCAO = declararTools([
  {
    name: "crm_calculate_removal_quote",
    category: "write",
    rotulo: "Calcular orçamento de remoção e abrir protocolo",
    explicacao:
      "Mostra as modalidades de remoção cadastradas (Simples, SIV, UTI...), calcula o preço exato de uma a partir do endereço de origem e destino, e registra um protocolo numerado no funil — para o assistente nunca chutar distância nem preço, e todo pedido ficar rastreável.",
    oQueToca: "Orçamento e protocolo de remoção",
    risco: "atencao",
    pacotes: ["vender"],
  },
]);
