"use client";

import { useT } from "@/hooks/i18n/useT";
/**
 * A QUE OUTROS SISTEMAS ESTE ASSISTENTE PODE CHAMAR FERRAMENTA (2026-09-10).
 *
 * Consumo do que `/app/ai/mcp-connections` só guardava e testava até aqui —
 * ver o aviso na própria tela de conexões. Mesmo molde de `BasesDoAgente`:
 *
 *  1. **Nomeia o estado vazio.** Nenhuma conexão marcada é LEGÍTIMO (é o
 *     default, e é falha fechada) — a frase diz o que acontece, não o que falta.
 *  2. **Avisa quando a conexão marcada não está confiável.** Marcar uma conexão
 *     que nunca validou, ou que está falhando agora, é uma promessa que não se
 *     cumpre: o agente vai tentar chamar e vai apanhar em silêncio, do lado de
 *     dentro de uma execução que ninguém vê.
 *  3. **Não usa jargão de protocolo.** Nada de "MCP" nem de "JSON-RPC" na frase
 *     principal: o dono do negócio lê "conversar com outro sistema", que é o
 *     que de fato acontece.
 */
import * as React from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export interface ConexaoMcpDoAgente {
  id: string;
  label: string;
  mcp_url: string;
  validated_at: string | null;
  validation_error: string | null;
}

interface Props {
  conexoes: ConexaoMcpDoAgente[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function ConexoesDoAgente({ conexoes, value, onChange, disabled = false }: Props) {
  const t = useT();
  const marcados = new Set(value);

  function alternar(id: string, marcado: boolean): void {
    const proximo = new Set(marcados);
    if (marcado) proximo.add(id);
    else proximo.delete(id);
    onChange([...proximo]);
  }

  const naoConfiaveis = conexoes.filter(
    (c) => marcados.has(c.id) && (c.validated_at === null || c.validation_error !== null),
  );

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-medium">{t("Outros sistemas que ele pode usar")}</h3>
        <p className="text-xs text-muted-foreground">
          {t(
            "Marque as conexões que este assistente pode chamar durante a conversa, além do que ele já faz aqui dentro.",
          )}
        </p>
      </div>

      {conexoes.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="agente-sem-conexao">
          {t("Você ainda não conectou nenhum sistema externo.")}{" "}
          <Link
            href="/app/ai/mcp-connections"
            className="font-medium text-foreground underline underline-offset-4"
          >
            {t("Conecte um em Outros sistemas")}
          </Link>{" "}
          {t("para poder liberar o assistente.")}
        </p>
      ) : (
        <div className="space-y-2" data-testid="agente-conexoes">
          {conexoes.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              {/* `input` nativo, como o ToolPicker e o BasesDoAgente ao lado: o
                  repo não tem componente de checkbox, e introduzir um só para
                  esta seção criaria duas aparências para o mesmo controle na
                  MESMA página. */}
              <input
                id={`conexao-${c.id}`}
                data-testid={`conexao-${c.id}`}
                type="checkbox"
                className="h-4 w-4 shrink-0 rounded-md border-border accent-primary"
                checked={marcados.has(c.id)}
                onChange={(e) => alternar(c.id, e.target.checked)}
                disabled={disabled}
                aria-label={c.label}
              />
              <Label htmlFor={`conexao-${c.id}`} className="text-sm font-normal">
                {c.label}
                <span className="ml-2 text-xs text-muted-foreground">
                  {c.validation_error
                    ? t("— conexão falhando")
                    : c.validated_at
                      ? t("— conectada")
                      : t("— ainda não testada")}
                </span>
              </Label>
            </div>
          ))}
        </div>
      )}

      {value.length === 0 && conexoes.length > 0 ? (
        <p data-testid="agente-sem-conexao-marcada" className="text-xs text-muted-foreground">
          {t(
            "Sem nenhuma conexão marcada, ele conversa normalmente, mas não chama ferramenta de nenhum outro sistema.",
          )}
        </p>
      ) : null}

      {naoConfiaveis.length > 0 ? (
        <p data-testid="agente-conexao-nao-confiavel" className="text-xs text-warning-fg">
          {naoConfiaveis.length === 1
            ? `"${naoConfiaveis[0]?.label}" ${t("está marcada mas a conexão não está confiável agora — o assistente vai tentar chamar e vai falhar em silêncio.")}`
            : `${naoConfiaveis.length} ${t("conexões marcadas não estão confiáveis agora — o assistente vai tentar chamar e vai falhar em silêncio.")}`}{" "}
          <Link
            href="/app/ai/mcp-connections"
            className="font-medium text-foreground underline underline-offset-4"
          >
            {t("Ver conexões")}
          </Link>
        </p>
      ) : null}
    </Card>
  );
}
