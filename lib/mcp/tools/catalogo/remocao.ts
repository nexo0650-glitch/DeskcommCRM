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
    name: "crm_list_removal_services",
    category: "read",
    rotulo: "Ver as modalidades de remoção",
    explicacao:
      "Mostra as modalidades de remoção cadastradas (Simples, SIV, UTI...) e o código de cada uma, para o assistente escolher a certa antes de calcular o orçamento.",
    oQueToca: "Modalidades de remoção",
    risco: "seguro",
    pacotes: ["vender"],
  },
  {
    name: "crm_calculate_removal_quote",
    category: "read",
    rotulo: "Calcular orçamento de remoção",
    explicacao:
      "Calcula o preço exato de uma remoção a partir do endereço de origem e destino e do trajeto completo do veículo, aplicando o valor fixo ou o valor por km conforme a distância — para o assistente nunca chutar distância nem preço.",
    oQueToca: "Orçamento de remoção",
    risco: "seguro",
    pacotes: ["vender"],
  },
]);
