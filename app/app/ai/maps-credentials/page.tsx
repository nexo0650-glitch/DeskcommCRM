import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { MapCredentialRow } from "@/hooks/maps/useMapCredentials";
import { traduzir } from "@/lib/i18n/dicionario";
import { MapCredentialsList } from "./_components/MapCredentialsList";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, is_active, created_by, created_at, updated_at";

export default async function MapCredentialsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const idioma = user.idioma;
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("map_provider_credentials_safe")
    .select(SAFE_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });

  const credentials = (data ?? []) as unknown as MapCredentialRow[];
  const canWrite = ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Chave de mapa (distância)", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Usada pro cálculo de distância de remoção (endereço de origem até o destino). Crie uma conta gratuita em openrouteservice.org e cole a chave aqui — ela é guardada criptografada.",
            idioma,
          )}
        </p>
      </header>
      <MapCredentialsList initialData={credentials} canWrite={canWrite} />
    </div>
  );
}
