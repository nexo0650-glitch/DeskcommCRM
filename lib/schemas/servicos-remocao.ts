import { z } from "zod";

/**
 * O CONTRATO DOS SERVIÇOS DE REMOÇÃO — um só, lido pela tela E pela rota.
 * Mesmo raciocínio de `lib/schemas/produtos.ts`: um schema por lado é como
 * nasce controle decorativo.
 */

const codigo = z
  .string()
  .trim()
  .min(1, "o código não pode ficar em branco")
  .max(60)
  .transform((v) => v.replace(/\s+/g, " "));

const nome = z.string().trim().min(2, "o nome precisa de ao menos 2 letras").max(200);

export const servicoRemocaoCreateSchema = z.object({
  codigo,
  nome,
  descricao: z.string().trim().max(2000).optional(),
  valor_ida_cents: z.number().int().min(0, "valor da ida não pode ser negativo"),
  valor_ida_e_volta_cents: z.number().int().min(0, "valor de ida e volta não pode ser negativo"),
  taxa_saida_cents: z.number().int().min(0, "taxa de saída não pode ser negativa").default(0),
  valor_km_cents: z.number().int().min(0, "valor do km não pode ser negativo"),
  limiar_km: z.number().min(0, "limiar de km não pode ser negativo"),
  ativo: z.boolean().default(true),
});

/** Tudo opcional: o PATCH muda o que veio e não encosta no resto. */
export const servicoRemocaoPatchSchema = servicoRemocaoCreateSchema.partial();

export type ServicoRemocaoCreate = z.infer<typeof servicoRemocaoCreateSchema>;
export type ServicoRemocaoPatch = z.infer<typeof servicoRemocaoPatchSchema>;

export interface ServicoRemocao {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  valor_ida_cents: number;
  valor_ida_e_volta_cents: number;
  taxa_saida_cents: number;
  valor_km_cents: number;
  limiar_km: number;
  moeda: string;
  ativo: boolean;
  updated_at: string;
}

/** As colunas que a tela e a rota leem — uma lista, não duas. */
export const COLUNAS_DO_SERVICO_REMOCAO =
  "id, codigo, nome, descricao, valor_ida_cents, valor_ida_e_volta_cents, taxa_saida_cents, " +
  "valor_km_cents, limiar_km, moeda, ativo, updated_at";
