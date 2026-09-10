"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { mcpConnectionsListQueryKey, type McpConnectionRow } from "@/hooks/mcp-cliente/useMcpConnections";
import { useT } from "@/hooks/i18n/useT";

const formSchema = z.object({
  label: z.string().trim().min(1, "Obrigatório").max(80),
  mcp_url: z.string().trim().url("URL inválida").refine((v) => v.startsWith("https://"), "Precisa começar com https://"),
  api_key: z.string().trim().min(8, "Chave muito curta").max(2048),
});

type FormValues = z.infer<typeof formSchema>;

interface CreateResponse {
  data: McpConnectionRow;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMcpConnectionDialog({ open, onOpenChange }: Props) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});

  const reset = () => {
    setLabel("");
    setMcpUrl("");
    setApiKey("");
    setErrors({});
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const parsed = formSchema.safeParse({ label, mcp_url: mcpUrl, api_key: apiKey });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setErrors({
        label: flat.label?.[0] ? t(flat.label[0]) : undefined,
        mcp_url: flat.mcp_url?.[0] ? t(flat.mcp_url[0]) : undefined,
        api_key: flat.api_key?.[0] ? t(flat.api_key[0]) : undefined,
      });
      return;
    }

    setSubmitting(true);
    const validatingToast = toast.loading(t("Conexão salva. Testando…"));
    try {
      const res = await apiClient.post<CreateResponse>("/api/v1/mcp-connections", parsed.data);
      toast.dismiss(validatingToast);
      toast.success(t("Conexão salva. Teste em segundo plano."));
      reset();
      onOpenChange(false);

      setTimeout(async () => {
        await qc.invalidateQueries({ queryKey: mcpConnectionsListQueryKey });
        const fresh = qc.getQueryData<McpConnectionRow[]>(mcpConnectionsListQueryKey);
        const justCreated = fresh?.find((c) => c.id === res.data.id);
        if (justCreated?.validated_at) {
          toast.success(t("Conectado — já achamos as ferramentas desse sistema."));
        } else if (justCreated?.validation_error) {
          toast.error(`${t("Conexão falhou")}: ${justCreated.validation_error}`);
        }
      }, 3000);

      await qc.invalidateQueries({ queryKey: mcpConnectionsListQueryKey });
      router.refresh();
    } catch (err) {
      toast.dismiss(validatingToast);
      showApiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onOpenChangeWrapped = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChangeWrapped}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Conectar a outro sistema")}</DialogTitle>
          <DialogDescription>
            {t(
              "A chave é cifrada (AES-GCM) antes de gravar e nunca é retornada em texto claro. A URL precisa ser https e pública — endereços internos são recusados.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mcpconn-label">{t("Nome")}</Label>
            <Input
              id="mcpconn-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("Ex: Sistema de estoque")}
              maxLength={80}
              required
            />
            {errors.label && <p className="text-xs text-destructive">{errors.label}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcpconn-url">{t("URL do MCP")}</Label>
            <Input
              id="mcpconn-url"
              value={mcpUrl}
              onChange={(e) => setMcpUrl(e.target.value)}
              placeholder="https://outro-sistema.com/mcp"
              autoComplete="off"
              required
            />
            {errors.mcp_url && <p className="text-xs text-destructive">{errors.mcp_url}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcpconn-key">{t("Chave")}</Label>
            <Input
              id="mcpconn-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="••••••••"
              autoComplete="off"
              required
            />
            {errors.api_key && <p className="text-xs text-destructive">{errors.api_key}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChangeWrapped(false)} disabled={submitting}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("Salvando…") : t("Salvar e testar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
