"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { precoParaCentavos, type Produto } from "@/lib/schemas/produtos";

interface Textos {
  titulo: string;
  subtitulo: string;
  vazio: string;
  vazioDica: string;
}

/** O preço como quem vende lê. */
function comoMoeda(cents: number, moeda: string): string {
  const v = (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  return moeda === "BRL" ? `R$ ${v}` : `${moeda} ${v}`;
}

/** Centavos -> texto editável ("5499,00"), pro formulário reabrir já preenchido. */
function comoTextoEditavel(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

interface ResumoDaImportacao {
  total_linhas: number;
  criados: number;
  atualizados: number;
  erros: Array<{ linha: number; motivo: string }>;
  colunas_ignoradas: string[];
}

interface Rascunho {
  codigo: string;
  nome: string;
  marca: string;
  categoria: string;
  preco: string;
  custo: string;
  precoPorKm: string;
  quantidade: string;
  controla_estoque: boolean;
}

const VAZIO: Rascunho = {
  codigo: "",
  nome: "",
  marca: "",
  categoria: "",
  preco: "",
  custo: "",
  precoPorKm: "",
  quantidade: "0",
  controla_estoque: true,
};

function doRascunho(
  r: Rascunho,
  t: (s: string) => string,
): Record<string, unknown> | { erro: string } {
  const preco_cents = precoParaCentavos(r.preco);
  if (preco_cents === null) return { erro: t("Preço inválido. Escreva assim: 5.499,00") };
  const custo_cents = r.custo.trim() === "" ? null : precoParaCentavos(r.custo);
  if (r.custo.trim() !== "" && custo_cents === null) return { erro: t("Custo inválido.") };
  const price_per_km_cents = r.precoPorKm.trim() === "" ? null : precoParaCentavos(r.precoPorKm);
  if (r.precoPorKm.trim() !== "" && price_per_km_cents === null) {
    return { erro: t("Preço por km inválido.") };
  }

  return {
    codigo: r.codigo.trim(),
    nome: r.nome.trim(),
    ...(r.marca.trim() ? { marca: r.marca.trim() } : {}),
    ...(r.categoria.trim() ? { categoria: r.categoria.trim() } : {}),
    preco_cents,
    custo_cents,
    price_per_km_cents,
    controla_estoque: r.controla_estoque,
    quantidade: Number(r.quantidade) || 0,
  };
}

function rascunhoDoProduto(p: Produto, codigoNovo?: string): Rascunho {
  return {
    codigo: codigoNovo ?? p.codigo,
    nome: p.nome,
    marca: p.marca ?? "",
    categoria: p.categoria ?? "",
    preco: comoTextoEditavel(p.preco_cents),
    custo: p.custo_cents != null ? comoTextoEditavel(p.custo_cents) : "",
    precoPorKm: p.price_per_km_cents != null ? comoTextoEditavel(p.price_per_km_cents) : "",
    quantidade: String(p.quantidade),
    controla_estoque: p.controla_estoque,
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

export function ProdutosClient({
  inicial,
  podeEditar,
  textos,
}: {
  inicial: Produto[];
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
  const [confirmandoExclusao, setConfirmandoExclusao] = React.useState<Produto | null>(null);
  const [importando, setImportando] = React.useState(false);
  const [resumo, setResumo] = React.useState<ResumoDaImportacao | null>(null);
  const arquivoRef = React.useRef<HTMLInputElement>(null);

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q === "") return inicial;
    return inicial.filter((p) =>
      [p.nome, p.codigo, p.marca ?? "", p.categoria ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [inicial, busca]);

  const codigosExistentes = React.useMemo(() => new Set(inicial.map((p) => p.codigo)), [inicial]);

  function abrirCriar() {
    setModo("criar");
    setEditandoId(null);
    setRascunho(VAZIO);
  }

  function abrirVer(p: Produto) {
    setModo("ver");
    setEditandoId(p.id);
    setRascunho(rascunhoDoProduto(p));
  }

  function abrirEditar(p: Produto) {
    setModo("editar");
    setEditandoId(p.id);
    setRascunho(rascunhoDoProduto(p));
  }

  function abrirCopiar(p: Produto) {
    setModo("copiar");
    setEditandoId(null);
    setRascunho(rascunhoDoProduto(p, codigoDeCopia(p.codigo, codigosExistentes)));
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
        await apiClient.patch(`/api/v1/products/${editandoId}`, corpo);
        toast.success(t("Produto atualizado"));
      } else {
        await apiClient.post("/api/v1/products", corpo);
        toast.success(t("Produto cadastrado"));
      }
      fechar();
      router.refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(p: Produto) {
    setExcluindoId(p.id);
    try {
      await apiClient.delete(`/api/v1/products/${p.id}`);
      toast.success(t("Produto excluído"));
      setConfirmandoExclusao(null);
      router.refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setExcluindoId(null);
    }
  }

  async function importar(arquivo: File) {
    setImportando(true);
    setResumo(null);
    try {
      const form = new FormData();
      form.append("file", arquivo);
      const res = await fetch("/api/v1/products/import", { method: "POST", body: form });
      const json = (await res.json()) as
        | { data: ResumoDaImportacao }
        | { error?: { message?: string } };
      if (!res.ok || !("data" in json)) {
        const msg = "error" in json ? json.error?.message : undefined;
        toast.error(msg ?? t("Não consegui ler essa planilha."));
        return;
      }
      // O resumo fica NA TELA, não num toast que some em 4 segundos: quem
      // importou 300 produtos precisa ler quais linhas foram recusadas e por quê.
      setResumo(json.data);
      router.refresh();
    } catch {
      toast.error(t("Não consegui enviar o arquivo."));
    } finally {
      setImportando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function alternarAtivo(p: Produto) {
    try {
      await apiClient.patch(`/api/v1/products/${p.id}`, { ativo: !p.ativo });
      toast.success(t(p.ativo ? "Produto desativado" : "Produto reativado"));
      router.refresh();
    } catch (e) {
      showApiError(e);
    }
  }

  const formAberto = modo !== null;
  const somenteLeitura = modo === "ver";
  const tituloForm =
    modo === "editar"
      ? t("Editar produto")
      : modo === "copiar"
        ? t("Copiar produto")
        : modo === "ver"
          ? t("Detalhes do produto")
          : t("Novo produto");

  return (
    <div className="mx-auto w-full max-w-5xl p-6" data-testid="tela-produtos">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{textos.titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{textos.subtitulo}</p>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={t("Buscar por nome, código ou marca")}
          className="h-9 w-full max-w-sm rounded-md border px-3 text-sm"
          data-testid="busca-produto"
        />
        {podeEditar ? (
          <>
            <Button onClick={() => (formAberto ? fechar() : abrirCriar())} data-testid="novo-produto">
              {t(formAberto ? "Cancelar" : "Novo produto")}
            </Button>
            <input
              ref={arquivoRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="arquivo-planilha"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importar(f);
              }}
            />
            <Button
              variant="outline"
              disabled={importando}
              onClick={() => arquivoRef.current?.click()}
              data-testid="importar-planilha"
            >
              {t(importando ? "Importando…" : "Importar planilha")}
            </Button>
          </>
        ) : null}
      </div>

      {podeEditar ? (
        // Rota de API que devolve o arquivo com `content-disposition:
        // attachment` — é download, não navegação de página, e `<Link>` do Next
        // faria navegação de cliente para algo que não é tela.
        <a
          href="/api/v1/products/import"
          download="modelo-catalogo.csv"
          className="mb-4 inline-block text-xs text-muted-foreground underline"
          data-testid="modelo-planilha"
        >
          {t("Baixar planilha modelo")}
        </a>
      ) : null}

      {resumo ? (
        <div className="mb-6 rounded-lg border p-4 text-sm" data-testid="resumo-importacao">
          <p className="font-medium">
            {resumo.criados} {t("novos")} · {resumo.atualizados} {t("atualizados")} ·{" "}
            {resumo.total_linhas} {t("linhas na planilha")}
          </p>
          {resumo.colunas_ignoradas.length > 0 ? (
            <p className="mt-2 text-muted-foreground">
              {t("Não usei estas colunas:")} {resumo.colunas_ignoradas.join(", ")}.
            </p>
          ) : null}
          {resumo.erros.length > 0 ? (
            <div className="mt-3">
              <p className="font-medium">{t("Linhas que não entraram:")}</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {resumo.erros.slice(0, 20).map((e) => (
                  <li key={`${e.linha}-${e.motivo}`}>
                    {t("Linha")} {e.linha}: {e.motivo}
                  </li>
                ))}
              </ul>
              {resumo.erros.length > 20 ? (
                <p className="mt-1 text-muted-foreground">
                  {t("…e mais")} {resumo.erros.length - 20}.
                </p>
              ) : null}
            </div>
          ) : null}
          <button className="mt-3 text-xs underline" onClick={() => setResumo(null)}>
            {t("Fechar")}
          </button>
        </div>
      ) : null}

      {formAberto ? (
        <div className="mb-6 rounded-lg border p-4" data-testid="form-produto">
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
                data-testid="produto-codigo"
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
                data-testid="produto-nome"
                disabled={somenteLeitura}
              />
            </label>
            <label className="text-sm">
              {t("Marca")}
              <input
                value={rascunho.marca}
                onChange={(e) => setRascunho({ ...rascunho, marca: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                disabled={somenteLeitura}
              />
            </label>
            <label className="text-sm">
              {t("Categoria")}
              <input
                value={rascunho.categoria}
                onChange={(e) => setRascunho({ ...rascunho, categoria: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                disabled={somenteLeitura}
              />
            </label>
            <label className="text-sm">
              {t("Preço de venda")}
              <input
                value={rascunho.preco}
                onChange={(e) => setRascunho({ ...rascunho, preco: e.target.value })}
                placeholder="5.499,00"
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                data-testid="produto-preco"
                disabled={somenteLeitura}
              />
            </label>
            <label className="text-sm">
              {t("Custo")} <span className="text-muted-foreground">{t("(opcional)")}</span>
              <input
                value={rascunho.custo}
                onChange={(e) => setRascunho({ ...rascunho, custo: e.target.value })}
                placeholder="4.100,00"
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                disabled={somenteLeitura}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("Serve para o atendente saber até onde pode negociar. Não aparece para o cliente.")}
              </span>
            </label>
            <label className="text-sm">
              {t("Preço por km rodado")} <span className="text-muted-foreground">{t("(opcional)")}</span>
              <input
                value={rascunho.precoPorKm}
                onChange={(e) => setRascunho({ ...rascunho, precoPorKm: e.target.value })}
                placeholder="3,00"
                className="mt-1 h-9 w-full rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                data-testid="produto-preco-por-km"
                disabled={somenteLeitura}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {t(
                  "Some ao preço acima por km rodado entre origem e destino. Usado pelo cálculo de orçamento de remoção — deixe em branco se este produto não é cobrado por distância.",
                )}
              </span>
            </label>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rascunho.controla_estoque}
              onChange={(e) => setRascunho({ ...rascunho, controla_estoque: e.target.checked })}
              data-testid="produto-controla-estoque"
              disabled={somenteLeitura}
            />
            {t("Controlar estoque deste produto")}
          </label>
          {rascunho.controla_estoque ? (
            <label className="mt-2 block text-sm">
              {t("Quantidade")}
              <input
                value={rascunho.quantidade}
                onChange={(e) => setRascunho({ ...rascunho, quantidade: e.target.value })}
                className="mt-1 h-9 w-32 rounded-md border px-3 disabled:bg-muted disabled:text-muted-foreground"
                disabled={somenteLeitura}
              />
            </label>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {t(
                "Sem controle de estoque, este produto sempre aparece como disponível para o atendente — é o certo para item sob encomenda ou fracionado.",
              )}
            </p>
          )}

          {!somenteLeitura ? (
            <div className="mt-4 flex gap-2">
              <Button onClick={salvar} disabled={salvando} data-testid="salvar-produto">
                {t(salvando ? "Salvando…" : modo === "editar" ? "Salvar alterações" : "Salvar produto")}
              </Button>
              <Button variant="outline" onClick={fechar} disabled={salvando}>
                {t("Cancelar")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center" data-testid="produtos-vazio">
          <p className="font-medium">{textos.vazio}</p>
          <p className="mt-1 text-sm text-muted-foreground">{textos.vazioDica}</p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="lista-produtos">
          {filtrados.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3" data-testid={`produto-${p.codigo}`}>
              <div className="min-w-0 flex-1">
                <p className={`truncate font-medium ${p.ativo ? "" : "text-muted-foreground line-through"}`}>
                  {p.nome}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.codigo}
                  {p.marca ? ` · ${p.marca}` : ""}
                  {p.controla_estoque
                    ? ` · ${p.quantidade} ${t("em estoque")}`
                    : ` · ${t("sem controle de estoque")}`}
                </p>
              </div>
              <span className="shrink-0 tabular-nums font-medium">
                {comoMoeda(p.preco_cents, p.moeda)}
                {p.price_per_km_cents != null ? (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {t("+")} {comoMoeda(p.price_per_km_cents, p.moeda)}/km
                  </span>
                ) : null}
              </span>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => abrirVer(p)}
                  data-testid={`ver-${p.codigo}`}
                >
                  {t("Ver")}
                </Button>
                {podeEditar ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => abrirEditar(p)}
                      data-testid={`editar-${p.codigo}`}
                    >
                      {t("Editar")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => abrirCopiar(p)}
                      data-testid={`copiar-${p.codigo}`}
                    >
                      {t("Copiar")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void alternarAtivo(p)}
                      data-testid={`alternar-${p.codigo}`}
                    >
                      {t(p.ativo ? "Desativar" : "Reativar")}
                    </Button>
                    {confirmandoExclusao?.id === p.id ? (
                      <span className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={excluindoId === p.id}
                          onClick={() => void excluir(p)}
                          data-testid={`confirmar-excluir-${p.codigo}`}
                        >
                          {t(excluindoId === p.id ? "Excluindo…" : "Confirmar")}
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
                        onClick={() => setConfirmandoExclusao(p)}
                        data-testid={`excluir-${p.codigo}`}
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
