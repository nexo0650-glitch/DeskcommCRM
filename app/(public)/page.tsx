import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { branding } from "@/lib/branding";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Entrar ou criar conta" };

/**
 * A PORTA DE ENTRADA — antes esta rota (`app/page.tsx`, fora do grupo
 * `(public)`) só fazia `redirect("/app")`, que por sua vez o layout de `/app`
 * bate de volta pra `/login` se não houver sessão: quem chegava aqui sem
 * conta ricocheteava duas vezes sem nunca ver um convite claro pra entrar ou
 * criar empresa. Mudou pra dentro de `(public)` de propósito — herda o
 * logo/marca da instalação de graça, mesmo shell de login/cadastro.
 *
 * Quem JÁ tem sessão não vê esta tela: seguir direto pro painel é o caminho
 * certo pra quem só está reabrindo a aba.
 */
export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");

  const idioma = normalizarIdioma(null);
  const t = (texto: string) => traduzir(texto, idioma);
  const marca = branding();

  return (
    <div className="space-y-6 text-center">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{marca.name}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Atendimento e vendas por WhatsApp, com agentes de IA.")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button asChild>
          <Link href="/login">{t("Entrar")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/signup">{t("Criar empresa")}</Link>
        </Button>
      </div>
    </div>
  );
}
