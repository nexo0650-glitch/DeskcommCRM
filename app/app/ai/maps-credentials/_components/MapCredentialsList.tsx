"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowsClockwise, Plus, Trash } from "@/lib/ui/icons";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  mapCredentialStatus,
  mapCredentialsListQueryKey,
  useMapCredentialsList,
  type MapCredentialRow,
} from "@/hooks/maps/useMapCredentials";
import { useT } from "@/hooks/i18n/useT";
import { AddMapCredentialDialog } from "./AddMapCredentialDialog";

interface Props {
  initialData: MapCredentialRow[];
  canWrite: boolean;
}

const STATUS_LABEL: Record<ReturnType<typeof mapCredentialStatus>, string> = {
  validated: "Validada",
  validating: "Validando…",
  invalid: "Inválida",
  inactive: "Inativa",
};

const STATUS_VARIANT: Record<
  ReturnType<typeof mapCredentialStatus>,
  "default" | "secondary" | "destructive" | "outline"
> = {
  validated: "default",
  validating: "secondary",
  invalid: "destructive",
  inactive: "outline",
};

function CredentialCard({ credential, canWrite }: { credential: MapCredentialRow; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const status = mapCredentialStatus(credential);
  const last4 = credential.api_key_last4 ?? "????";

  async function revalidar() {
    setPending(true);
    try {
      await apiClient.post(`/api/v1/maps/credentials/${credential.id}/revalidate`, {});
      toast.success(t("Testando a chave…"));
      await qc.invalidateQueries({ queryKey: mapCredentialsListQueryKey });
    } catch (err) {
      showApiError(err);
    } finally {
      setPending(false);
    }
  }

  async function excluir() {
    setPending(true);
    try {
      await apiClient.delete(`/api/v1/maps/credentials/${credential.id}`);
      toast.success(t("Credencial removida."));
      setDeleteOpen(false);
      await qc.invalidateQueries({ queryKey: mapCredentialsListQueryKey });
    } catch (err) {
      showApiError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium" title={credential.label}>
            {credential.label}
          </h3>
          <p className="font-mono text-xs text-muted-foreground">…{last4}</p>
        </div>
        <Badge variant={STATUS_VARIANT[status]} className="text-xs">
          {t(STATUS_LABEL[status])}
        </Badge>
      </div>

      {credential.validation_error && (
        <p className="line-clamp-2 text-xs text-destructive" title={credential.validation_error}>
          {credential.validation_error}
        </p>
      )}

      {canWrite && (
        <div className="flex items-center justify-end gap-1 pt-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Testar credencial")}
            disabled={pending}
            onClick={() => void revalidar()}
          >
            <ArrowsClockwise size={14} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Excluir credencial")}
            disabled={pending}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash size={14} aria-hidden />
          </Button>
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Remover credencial")} &ldquo;{credential.label}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("O cálculo de distância de remoção para de funcionar até outra chave ser cadastrada. Esta ação não pode ser desfeita.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void excluir()} disabled={pending}>
              {t("Remover")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function MapCredentialsList({ initialData, canWrite }: Props) {
  const t = useT();
  const { data } = useMapCredentialsList({ initialData });
  const [addOpen, setAddOpen] = useState(false);
  const credentials = data ?? [];

  if (credentials.length === 0) {
    return (
      <>
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <h2 className="font-medium">{t("Nenhuma chave de mapa cadastrada ainda")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t(
              "Sem uma chave da OpenRouteService, o cálculo de distância de remoção não funciona — crie uma conta gratuita em openrouteservice.org e cole a chave aqui.",
            )}
          </p>
          {canWrite && (
            <Button className="mt-1" onClick={() => setAddOpen(true)}>
              <Plus size={14} aria-hidden className="mr-2" /> {t("Adicionar credencial")}
            </Button>
          )}
        </Card>
        <AddMapCredentialDialog open={addOpen} onOpenChange={setAddOpen} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex sm:justify-end">
        {canWrite && (
          <Button onClick={() => setAddOpen(true)} className="w-full sm:w-auto">
            <Plus size={14} aria-hidden className="mr-2" /> {t("Adicionar credencial")}
          </Button>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {credentials.map((row) => (
          <li key={row.id}>
            <CredentialCard credential={row} canWrite={canWrite} />
          </li>
        ))}
      </ul>
      <AddMapCredentialDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
