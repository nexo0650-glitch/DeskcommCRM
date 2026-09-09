"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export type MapProvider = "openrouteservice";

export interface MapCredentialRow {
  id: string;
  organization_id: string;
  provider: MapProvider;
  label: string;
  api_key_last4: string | null;
  validated_at: string | null;
  validation_error: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  data: MapCredentialRow[];
}

export const mapCredentialsListQueryKey = ["maps", "credentials", "list"] as const;

export function useMapCredentialsList(opts?: { initialData?: MapCredentialRow[] }) {
  return useQuery({
    queryKey: mapCredentialsListQueryKey,
    queryFn: async () => {
      try {
        const res = await apiClient.get<ListResponse>("/api/v1/maps/credentials");
        return res.data;
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    initialData: opts?.initialData,
  });
}

export function mapCredentialStatus(
  row: MapCredentialRow,
): "validated" | "validating" | "invalid" | "inactive" {
  if (!row.is_active) return "inactive";
  if (row.validation_error) return "invalid";
  if (row.validated_at) return "validated";
  return "validating";
}
