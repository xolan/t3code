import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  slashCommands: () => ["server", "slashCommands"] as const,
};

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    staleTime: Infinity,
  });
}

export function slashCommandsQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.slashCommands(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listSlashCommands();
    },
    staleTime: Infinity,
  });
}
