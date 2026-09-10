import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { McpConnectionRow } from "@/hooks/mcp-cliente/useMcpConnections";
import { traduzir } from "@/lib/i18n/dicionario";
import { McpConnectionsList } from "./_components/McpConnectionsList";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS =
  "id, organization_id, label, mcp_url, api_key_last4, validated_at, validation_error, tools_encontradas, is_active, created_by, created_at, updated_at";

/**
 * CONEXÃO COM OUTRO SISTEMA (MCP) — só a metade de credencial. Guarda URL +
 * chave, valida de verdade contra o servidor externo (initialize +
 * tools/list). O CONSUMO (o agente desta org chamando as ferramentas de lá
 * durante uma conversa) é trabalho separado, ainda não construído — sem essa
 * chave validada aqui, ele nem teria como existir.
 */
export default async function McpConnectionsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const idioma = user.idioma;
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("external_mcp_connections_safe")
    .select(SAFE_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });

  const connections = (data ?? []) as unknown as McpConnectionRow[];
  const canWrite = ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Conectar a outro sistema (MCP)", idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Cole a URL e a chave de outro sistema que fale o protocolo MCP. Testamos a conexão de verdade e listamos o que ele oferece.",
            idioma,
          )}
        </p>
      </header>
      <McpConnectionsList initialData={connections} canWrite={canWrite} />
    </div>
  );
}
