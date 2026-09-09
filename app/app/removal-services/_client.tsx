"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { precoParaCentavos } from "@/lib/schemas/produtos";
import { type ServicoRemocao } from "@/lib/schemas/servicos-remocao";
import { formatCents } from "@/lib/money";

interface Textos {
  titulo: string;
  subtitulo: string;
  vazio: string;
  vazioDica: string;
}

/** Centavos -> texto editável ("5499,00"), pro formulário reabrir já preenchido. */
function comoTextoEditavel(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

interface Rascunho {
  codigo: string;
  nome: string;
  descricao: string;
  valorIda: string;
  valorIdaEVolta: string;
  taxaSaida: string;
  valorKm: string;
  limiarKm: string;
}

const VAZIO: Rascunho = {
  codigo: "",
  nome: "",
  descricao: "",
  valorIda: "",
  valorIdaEVolta: "",
  taxaSaida: "0,00",
  valorKm: "",
  limiarKm: "50",
};

function doRascunho(
  r: Rascunho,
  t: (s: string) => string,
): Record<string, unknown> | { erro: string } {
  const valor_ida_cents = precoParaCentavos(r.valorIda);
  if (valor_ida_cents === null) return { erro: t("Valor da ida inválido. Escreva assim: 250,00") };
  const valor_ida_e_volta_cents = precoParaCentavos(r.valorIdaEVolta);
  if (valor_ida_e_volta_cents === null) return { erro: t("Valor de ida e volta inválido.") };
  const taxa_saida_cents = r.taxaSaida.trim() === "" ? 0 : precoParaCentavos(r.taxaSaida);
  if (taxa_saida_cents === null) return { erro: t("Taxa de saída inválida.") };
  const valor_km_cents = precoParaCentavos(r.valorKm);
  if (valor_km_cents === null) return { erro: t("Valor do km inválido.") };
  const limiarNum = Number(r.limiarKm.replace(",", "."));
  if (!Number.isFinite(limiarNum) || limiarNum < 0) {
    return { erro: t("Limiar de km inválido.") };
  }

  return {
    codigo: r.codigo.trim(),
    nome: r.nome.trim(),
    ...(r.descricao.trim() ? { descricao: r.descricao.trim() } : {}),
    valor_ida_cents,
    valor_ida_e_volta_cents,
    taxa_saida_cents,
    valor_km_cents,
    limiar_km: limiarNum,
  };
}

function rascunhoDoServico(s: ServicoRemocao, codigoNovo?: string): Rascunho {
  return {
    codigo: codigoNovo ?? s.codigo,
    nome: s.nome,
    descricao: s.descricao ?? "",
    valorIda: comoTextoEditavel(s.valor_ida_cents),
    valorIdaEVolta: comoTextoEditavel(s.valor_ida_e_volta_cents),
    taxaSaida: comoTextoEditavel(s.taxa_saida_cents),
    valorKm: comoTextoEditavel(s.valor_km_cents),
    limiarKm: String(s.limiar_km),
  };
}

/** Sugere um código livre pra cópia: acrescenta "-COPIA", "-COPIA-2", ... */
function codigoDeCopia(codigoOriginal: string, existentes: Set<string>): string {
  const base = `${codigoOriginal}-COPIA`;
  if (!existentes.has(base)) return base;
  let n = 2;
  while (existentes.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

type ModoFormulario = "criar" | "editar" | "copiar" | "ver";

export function ServicosRemocaoClient({
  inicial,
  podeEditar,
  textos,
}: {
  inicial: ServicoRemocao[];
  podeEditar: boolean;
  textos: Textos;
}) {
  const t = useT();
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [modo, setModo] = React.useState<ModoFormulario | null>(null);
  const [editandoId, setEditandoId] = React.useState<string | null>(null);
  const [rascunho, setRascunho] = React.useState<Rascunho>(VAZIO);
  const [salvando, setSalvando] = React.useState(false);
  const [excluindoId, setExcluindoId] = React.useState<string | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = React.useState<ServicoRemocao | null>(null);

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q === "") return inicial;
    return inicial.filter((s) => [s.nome, s.codigo].join(" ").toLowerCase().includes(q));
  }, [inicial, busca]);

  const codigosExistentes = React.useMemo(() => new Set(inicial.map((s) => s.codigo)), [inicial]);

  function abrirCriar() {
    setModo("criar");
    setEditandoId(null);
    setRascunho(VAZIO);
  }

  function abrirVer(s: ServicoRemocao) {
    setModo("ver");
    setEditandoId(s.id);
    setRascunho(rascunhoDoServico(s));
  }

  function abrirEditar(s: ServicoRemocao) {
    setModo("editar");
    setEditandoId(s.id);
    setRascunho(rascunhoDoServico(s));
  }

  function abrirCopiar(s: ServicoRemocao) {
    setModo("copiar");
    setEditandoId(null);
    setRascunho(rascunhoDoServico(s, codigoDeCopia(s.codigo, codigosExistentes)));
  }

  function fechar() {
    setModo(null);
    setEditandoId(null);
    setRascunho(VAZIO);
  }

  async function salvar() {
    const corpo = doRascunho(rascunho, t);
    if ("erro" in corpo) {
      toast.error(corpo.erro as string);
      return;
    }
    setSalvando(true);
    try {
      if (modo === "editar" && editandoId) {
        await apiClient.patch(`/api/v1/removal-services/${editandoId}`, corpo);
        toast.success(t("Serviço atualizado"));
      } else {
        await apiClient.post("/api/v1/removal-services", corpo);
        toast.success(t("Serviço cadastrado"));
      }
      fechar();
      router.refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(s: ServicoRemocao) {
    setExcluindoId(s.id);
    try {
      await apiClient.delete(`/api/v1/removal-services/${s.id}`);
      toast.success(t("Serviço excluído"));
      setConfirmandoExclusao(null);
      router.refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setExcluindoId(null);
    }
  }

  async function alternarAtivo(s: ServicoRemocao) {
    try {
      await apiClient.patch(`/api/v1/removal-services/${s.id}`, { ativo: !s.ativo });
      toast.success(t(s.ativo ? "Serviço desativado" : "Serviço reativado"));
      router.refresh();
    } catch (e) {
      showApiError(e);
    }
  }

  const formAberto = modo !== null;
  const somenteLeitura = modo === "ver";
  const tituloForm =
    modo === "editar"
      ? t("Editar serviço")
      : modo === "copiar"
        ? t("Copiar serviço")
        : modo === "ver"
          ? t("Detalhes do serviço")
          : t("Novo serviço");

  return (
    <div className="mx-auto w-full max-w-5xl p-6" data-testid="tela-servicos-remocao">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{textos.titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{textos.subtitulo}</p>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={t("Buscar por nome ou código")}
          className="h-9 w-full max-w-sm rounded-md border px-3 text-sm"
          data-testid="busca-servico-remocao"
        />
        {podeEditar ? (
          <Button onClick={() => (formAberto ? fechar() : abrirCriar())} data-testid="novo-servico-remocao">
            {t(formAberto ? "Cancelar" : "Novo serviço")}
          </Button>
        ) : null}
      </div>

      {formAberto ? (
        <div className="mb-6 rounded-lg border p-4" data-testid="form-servico-remocao">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{tituloForm}</h2>
            {modo === "ver" ? (
              <button type="button" className="text-xs text-muted-foreground underline" onClick={fechar}>
                {t("Fechar")}
              </button>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {t("Código")}
              <input
                value={rascunho.codigo}
                onChange={(e) => setRascunho({ ...rascunho, codigo: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                data-testid="servico-codigo"
                disabled={somenteLeitura || modo === "editar"}
                title={modo === "editar" ? t("O código não muda depois de criado.") : undefined}
              />
            </label>
            <label className="text-sm">
              {t("Nome")}
              <input
                value={rascunho.nome}
                onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                data-testid="servico-nome"
                disabled={somenteLeitura}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              {t("Descrição")} <span className="text-muted-foreground">{t("(opcional)")}</span>
              <input
                value={rascunho.descricao}
                onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                disabled={somenteLeitura}
              />
            </label>
            <label className="text-sm">
              {t("Valor da ida")}
              <input
                value={rascunho.valorIda}
                onChange={(e) => setRascunho({ ...rascunho, valorIda: e.target.value })}
                placeholder="250,00"
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                data-testid="servico-valor-ida"
                disabled={somenteLeitura}
              />
            </label>
            <label className="text-sm">
              {t("Valor de ida e volta")}
              <input
                value={rascunho.valorIdaEVolta}
                onChange={(e) => setRascunho({ ...rascunho, valorIdaEVolta: e.target.value })}
                placeholder="450,00"
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                data-testid="servico-valor-ida-volta"
                disabled={somenteLeitura}
              />
            </label>
            <label className="text-sm">
              {t("Taxa de saída")}
              <input
                value={rascunho.taxaSaida}
                onChange={(e) => setRascunho({ ...rascunho, taxaSaida: e.target.value })}
                placeholder="0,00"
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                data-testid="servico-taxa-saida"
                disabled={somenteLeitura}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("Cobrada uma vez por chamada, sempre — some ao valor da ida/ida-e-volta ou ao cálculo por km.")}
              </span>
            </label>
            <label className="text-sm">
              {t("Valor por km")}
              <input
                value={rascunho.valorKm}
                onChange={(e) => setRascunho({ ...rascunho, valorKm: e.target.value })}
                placeholder="3,00"
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                data-testid="servico-valor-km"
                disabled={somenteLeitura}
              />
            </label>
            <label className="text-sm">
              {t("A partir de quantos km cobra por km")}
              <input
                value={rascunho.limiarKm}
                onChange={(e) => setRascunho({ ...rascunho, limiarKm: e.target.value })}
                placeholder="50"
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                data-testid="servico-limiar-km"
                disabled={somenteLeitura}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {t(
                  "Abaixo deste km, o orçamento usa o valor da ida (ou ida e volta). A partir dele, usa o valor por km — os dois nunca somam.",
                )}
              </span>
            </label>
          </div>

          {!somenteLeitura ? (
            <div className="mt-4 flex gap-2">
              <Button onClick={salvar} disabled={salvando} data-testid="salvar-servico-remocao">
                {t(salvando ? "Salvando…" : modo === "editar" ? "Salvar alterações" : "Salvar serviço")}
              </Button>
              <Button variant="outline" onClick={fechar} disabled={salvando}>
                {t("Cancelar")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center" data-testid="servicos-remocao-vazio">
          <p className="font-medium">{textos.vazio}</p>
          <p className="mt-1 text-sm text-muted-foreground">{textos.vazioDica}</p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="lista-servicos-remocao">
          {filtrados.map((s) => (
            <li key={s.id} className="flex items-center gap-3 p-3" data-testid={`servico-${s.codigo}`}>
              <div className="min-w-0 flex-1">
                <p className={`truncate font-medium ${s.ativo ? "" : "text-muted-foreground line-through"}`}>
                  {s.nome}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.codigo} · {t("ida")} {formatCents(s.valor_ida_cents, s.moeda)} · {t("ida e volta")}{" "}
                  {formatCents(s.valor_ida_e_volta_cents, s.moeda)} · {formatCents(s.valor_km_cents, s.moeda)}{" "}
                  {t("por km após")} {s.limiar_km} {t("km")}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => abrirVer(s)} data-testid={`ver-${s.codigo}`}>
                  {t("Ver")}
                </Button>
                {podeEditar ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => abrirEditar(s)}
                      data-testid={`editar-${s.codigo}`}
                    >
                      {t("Editar")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => abrirCopiar(s)}
                      data-testid={`copiar-${s.codigo}`}
                    >
                      {t("Copiar")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void alternarAtivo(s)}
                      data-testid={`alternar-${s.codigo}`}
                    >
                      {t(s.ativo ? "Desativar" : "Reativar")}
                    </Button>
                    {confirmandoExclusao?.id === s.id ? (
                      <span className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={excluindoId === s.id}
                          onClick={() => void excluir(s)}
                          data-testid={`confirmar-excluir-${s.codigo}`}
                        >
                          {t(excluindoId === s.id ? "Excluindo…" : "Confirmar")}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setConfirmandoExclusao(null)}>
                          {t("Cancelar")}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setConfirmandoExclusao(s)}
                        data-testid={`excluir-${s.codigo}`}
                      >
                        {t("Excluir")}
                      </Button>
                    )}
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
