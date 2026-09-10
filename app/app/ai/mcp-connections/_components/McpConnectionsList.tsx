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
  mcpConnectionStatus,
  mcpConnectionsListQueryKey,
  useMcpConnectionsList,
  type McpConnectionRow,
} from "@/hooks/mcp-cliente/useMcpConnections";
import { useT } from "@/hooks/i18n/useT";
import { AddMcpConnectionDialog } from "./AddMcpConnectionDialog";

interface Props {
  initialData: McpConnectionRow[];
  canWrite: boolean;
}

const STATUS_LABEL: Record<ReturnType<typeof mcpConnectionStatus>, string> = {
  validated: "Conectada",
  validating: "Testando…",
  invalid: "Falhou",
  inactive: "Inativa",
};

const STATUS_VARIANT: Record<
  ReturnType<typeof mcpConnectionStatus>,
  "default" | "secondary" | "destructive" | "outline"
> = {
  validated: "default",
  validating: "secondary",
  invalid: "destructive",
  inactive: "outline",
};

function ConnectionCard({ connection, canWrite }: { connection: McpConnectionRow; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const status = mcpConnectionStatus(connection);
  const qtdFerramentas = connection.tools_encontradas?.length ?? 0;

  async function revalidar() {
    setPending(true);
    try {
      await apiClient.post(`/api/v1/mcp-connections/${connection.id}/revalidate`, {});
      toast.success(t("Testando a conexão…"));
      await qc.invalidateQueries({ queryKey: mcpConnectionsListQueryKey });
    } catch (err) {
      showApiError(err);
    } finally {
      setPending(false);
    }
  }

  async function excluir() {
    setPending(true);
    try {
      await apiClient.delete(`/api/v1/mcp-connections/${connection.id}`);
      toast.success(t("Conexão removida."));
      setDeleteOpen(false);
      await qc.invalidateQueries({ queryKey: mcpConnectionsListQueryKey });
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
          <h3 className="truncate font-medium" title={connection.label}>
            {connection.label}
          </h3>
          <p className="truncate text-xs text-muted-foreground" title={connection.mcp_url}>
            {connection.mcp_url}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[status]} className="shrink-0 text-xs">
          {t(STATUS_LABEL[status])}
        </Badge>
      </div>

      {status === "validated" && (
        <p className="text-xs text-muted-foreground">
          {qtdFerramentas} {qtdFerramentas === 1 ? t("ferramenta encontrada") : t("ferramentas encontradas")}
        </p>
      )}

      {connection.validation_error && (
        <p className="line-clamp-2 text-xs text-destructive" title={connection.validation_error}>
          {connection.validation_error}
        </p>
      )}

      {canWrite && (
        <div className="flex items-center justify-end gap-1 pt-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Testar conexão")}
            disabled={pending}
            onClick={() => void revalidar()}
          >
            <ArrowsClockwise size={14} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Excluir conexão")}
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
              {t("Remover conexão")} &ldquo;{connection.label}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("O agente desta empresa não vai mais conseguir usar este sistema. Esta ação não pode ser desfeita.")}
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

export function McpConnectionsList({ initialData, canWrite }: Props) {
  const t = useT();
  const { data } = useMcpConnectionsList({ initialData });
  const [addOpen, setAddOpen] = useState(false);
  const connections = data ?? [];

  if (connections.length === 0) {
    return (
      <>
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <h2 className="font-medium">{t("Nenhuma conexão cadastrada ainda")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t(
              "Conecte outro sistema que fale o protocolo MCP — cole a URL e a chave que esse sistema te deu.",
            )}
          </p>
          {canWrite && (
            <Button className="mt-1" onClick={() => setAddOpen(true)}>
              <Plus size={14} aria-hidden className="mr-2" /> {t("Adicionar conexão")}
            </Button>
          )}
        </Card>
        <AddMcpConnectionDialog open={addOpen} onOpenChange={setAddOpen} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex sm:justify-end">
        {canWrite && (
          <Button onClick={() => setAddOpen(true)} className="w-full sm:w-auto">
            <Plus size={14} aria-hidden className="mr-2" /> {t("Adicionar conexão")}
          </Button>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {connections.map((row) => (
          <li key={row.id}>
            <ConnectionCard connection={row} canWrite={canWrite} />
          </li>
        ))}
      </ul>
      <AddMcpConnectionDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
