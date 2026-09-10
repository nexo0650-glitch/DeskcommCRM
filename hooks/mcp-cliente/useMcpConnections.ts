"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface McpConnectionRow {
  id: string;
  organization_id: string;
  label: string;
  mcp_url: string;
  api_key_last4: string | null;
  validated_at: string | null;
  validation_error: string | null;
  tools_encontradas: Array<{ name: string; description?: string }>;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  data: McpConnectionRow[];
}

export const mcpConnectionsListQueryKey = ["mcp-cliente", "connections", "list"] as const;

export function useMcpConnectionsList(opts?: { initialData?: McpConnectionRow[] }) {
  return useQuery({
    queryKey: mcpConnectionsListQueryKey,
    queryFn: async () => {
      try {
        const res = await apiClient.get<ListResponse>("/api/v1/mcp-connections");
        return res.data;
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    initialData: opts?.initialData,
  });
}

export function mcpConnectionStatus(
  row: McpConnectionRow,
): "validated" | "validating" | "invalid" | "inactive" {
  if (!row.is_active) return "inactive";
  if (row.validation_error) return "invalid";
  if (row.validated_at) return "validated";
  return "validating";
}
