import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";

export function usePlatformCapabilities() {
  const query = useQuery({
    ...trpc.platform.getCapabilities.queryOptions(),
    staleTime: 300_000,
  });

  const capabilities = query.data;
  const mode = capabilities?.mode ?? "self-hosted";

  return {
    capabilities,
    isLoading: query.isLoading,
    mode,
    isDesktop: mode === "desktop",
    isCloud: mode === "cloud",
    isSelfHosted: mode === "self-hosted",
  };
}
