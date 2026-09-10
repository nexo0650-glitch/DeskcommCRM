import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  ChatCircle,
  Kanban,
  CalendarBlank,
  Storefront,
  ClockCountdown,
  ArrowBendUpLeft,
  UsersThree,
  ChartBar,
  ShieldCheck,
} from "@/lib/ui/icons";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

/**
 * A PORTA DE ENTRADA — página de marketing de verdade, não só um convite pra
 * entrar. Fora do grupo `(public)` de propósito: aquela casca trava a largura
 * em `max-w-sm` (certo pra um formulário de login, curto demais pra explicar
 * o produto) — então esta página resolve a própria marca/logo direto, com o
 * mesmo resolvedor (`marcaDaSaida`, nunca lança) em vez de herdar a casca.
 *
 * Quem JÁ tem sessão pula direto pro painel — a lista de funcionalidades é
 * pra quem ainda está decidindo, não pra quem já decidiu.
 */
export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");

  const idioma = normalizarIdioma(null);
  const t = (texto: string) => traduzir(texto, idioma);
  const marca = await marcaDaSaida(null);

  const funcionalidades = [
    {
      icon: ChatCircle,
      titulo: t("Atendimento por WhatsApp com IA"),
      descricao: t(
        "O agente responde na hora, entende o histórico da conversa e nunca deixa o cliente esperando — dia e noite, sem escala.",
      ),
    },
    {
      icon: Kanban,
      titulo: t("Funil de vendas visual"),
      descricao: t(
        "Cada conversa vira um card que anda sozinho pelas etapas do funil, junto com o que a sua equipe já faz hoje.",
      ),
    },
    {
      icon: CalendarBlank,
      titulo: t("Agenda que se preenche sozinha"),
      descricao: t(
        "O agente marca, remarca e cancela horário direto na conversa, sem ninguém precisar copiar nada pra planilha.",
      ),
    },
    {
      icon: Storefront,
      titulo: t("Catálogo sempre atualizado"),
      descricao: t(
        "Produtos, serviços e preço exato — o agente responde com o valor certo, nunca um chute de cabeça.",
      ),
    },
    {
      icon: ClockCountdown,
      titulo: t("Ninguém fica sem resposta"),
      descricao: t(
        "Follow-up automático retoma quem parou de responder, antes que o cliente esfrie e procure outro lugar.",
      ),
    },
    {
      icon: ArrowBendUpLeft,
      titulo: t("A IA chama a equipe quando precisa"),
      descricao: t(
        "Nos casos que exigem uma pessoa, o agente entrega a conversa com o contexto pronto — ninguém começa do zero.",
      ),
    },
    {
      icon: UsersThree,
      titulo: t("Sua equipe, com papéis diferentes"),
      descricao: t(
        "Convide quem atende, quem gerencia e quem administra — cada um vê e faz só o que precisa.",
      ),
    },
    {
      icon: ChartBar,
      titulo: t("Veja o que está funcionando"),
      descricao: t(
        "Relatórios de atendimento e vendas pra decidir com número, não com impressão."
      ),
    },
    {
      icon: ShieldCheck,
      titulo: t("Dados protegidos, empresa por empresa"),
      descricao: t(
        "Isolamento total entre organizações e conformidade com a LGPD desde o primeiro dia.",
      ),
    },
  ];

  return (
    <IdiomaProvider locale={null}>
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2">
              {marca.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  data-testid="logo-da-fachada"
                  src={marca.logoUrl}
                  alt={marca.nome}
                  className="h-8 w-auto max-w-[10rem] object-contain"
                />
              ) : (
                <span className="text-lg font-semibold tracking-tight">{marca.nome}</span>
              )}
            </div>
            <Button asChild variant="ghost">
              <Link href="/login">{t("Entrar")}</Link>
            </Button>
          </div>
        </header>

        <main>
          <section className="mx-auto max-w-5xl px-6 py-20 text-center">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              {t("Atenda, venda e cresça pelo WhatsApp com IA")}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              {t(
                "Um sistema de vendas com agentes de IA nativos que atendem, qualificam e movem o funil junto com a sua equipe — sem deixar ninguém sem resposta.",
              )}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">{t("Criar empresa grátis")}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">{t("Já tenho conta")}</Link>
              </Button>
            </div>
          </section>

          <section className="border-t bg-muted/30">
            <div className="mx-auto max-w-5xl px-6 py-16">
              <h2 className="text-center text-2xl font-semibold tracking-tight">
                {t("Tudo que a operação de vendas precisa, num só lugar")}
              </h2>
              <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {funcionalidades.map((f) => (
                  <div key={f.titulo} className="rounded-lg border bg-background p-5">
                    <f.icon size={24} className="text-primary" aria-hidden />
                    <h3 className="mt-3 font-medium">{f.titulo}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{f.descricao}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mx-auto max-w-3xl px-6 py-20 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              {t("Comece a atender pelo WhatsApp hoje")}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {t("Crie sua empresa em minutos — sem cartão de crédito.")}
            </p>
            <div className="mt-6">
              <Button asChild size="lg">
                <Link href="/signup">{t("Criar empresa grátis")}</Link>
              </Button>
            </div>
          </section>
        </main>

        <footer className="border-t">
          <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row">
            <span>{marca.nome}</span>
            <span>
              {t("Já tem conta?")}{" "}
              <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
                {t("Entrar")}
              </Link>
            </span>
          </div>
        </footer>
      </div>
    </IdiomaProvider>
  );
}
