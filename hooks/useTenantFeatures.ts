"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export interface UpdateTenantFeaturesPayload {
  id: string;
  remocao_ativa: boolean;
}

export function useUpdateTenantFeatures() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, remocao_ativa }: UpdateTenantFeaturesPayload) =>
      apiClient.patch(`/api/v1/admin/tenants/${id}/features`, { remocao_ativa }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", variables.id] });
      toast.success(
        variables.remocao_ativa
          ? "Cálculo de remoção ativado pra este tenant"
          : "Cálculo de remoção desativado pra este tenant",
      );
    },
    onError: (err: Error) => {
      toast.error("Erro ao mudar a funcionalidade", { description: err.message });
    },
  });
}
