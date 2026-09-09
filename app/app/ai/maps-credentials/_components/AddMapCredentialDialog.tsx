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
import { mapCredentialsListQueryKey, type MapCredentialRow } from "@/hooks/maps/useMapCredentials";
import { useT } from "@/hooks/i18n/useT";

const formSchema = z.object({
  label: z.string().trim().min(1, "Obrigatório").max(80),
  api_key: z.string().trim().min(8, "Chave muito curta").max(2048),
});

type FormValues = z.infer<typeof formSchema>;

interface CreateResponse {
  data: MapCredentialRow;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMapCredentialDialog({ open, onOpenChange }: Props) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});

  const reset = () => {
    setLabel("");
    setApiKey("");
    setErrors({});
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const parsed = formSchema.safeParse({ label, api_key: apiKey });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setErrors({
        label: flat.label?.[0] ? t(flat.label[0]) : undefined,
        api_key: flat.api_key?.[0] ? t(flat.api_key[0]) : undefined,
      });
      return;
    }

    setSubmitting(true);
    const validatingToast = toast.loading(t("Credencial salva. Testando…"));
    try {
      const res = await apiClient.post<CreateResponse>("/api/v1/maps/credentials", {
        provider: "openrouteservice",
        ...parsed.data,
      });
      toast.dismiss(validatingToast);
      toast.success(t("Credencial salva. Teste em segundo plano."));
      reset();
      onOpenChange(false);

      setTimeout(async () => {
        await qc.invalidateQueries({ queryKey: mapCredentialsListQueryKey });
        const fresh = qc.getQueryData<MapCredentialRow[]>(mapCredentialsListQueryKey);
        const justCreated = fresh?.find((c) => c.id === res.data.id);
        if (justCreated?.validated_at) {
          toast.success(t("Chave validada — o cálculo de distância já pode usá-la."));
        } else if (justCreated?.validation_error) {
          toast.error(`${t("Validação falhou")}: ${justCreated.validation_error}`);
        }
      }, 3000);

      await qc.invalidateQueries({ queryKey: mapCredentialsListQueryKey });
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
          <DialogTitle>{t("Adicionar credencial de mapa")}</DialogTitle>
          <DialogDescription>
            {t(
              "A chave é cifrada (AES-GCM) antes de gravar e nunca é retornada em texto claro. Crie uma chave gratuita em openrouteservice.org.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mapcred-label">{t("Label")}</Label>
            <Input
              id="mapcred-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("Ex: Produção")}
              maxLength={80}
              required
            />
            {errors.label && <p className="text-xs text-destructive">{errors.label}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mapcred-key">{t("Chave da OpenRouteService")}</Label>
            <Input
              id="mapcred-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="eyJvcmciOi..."
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
