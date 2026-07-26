import { useQuery } from "@tanstack/react-query";
import { getServerApiUrl } from "@/lib/server-url";

type SystemConfig = {
  isCloud: boolean;
};

async function fetchSystemConfig(): Promise<SystemConfig> {
  const response = await fetch(getServerApiUrl("/api/setup/status"), {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Unable to load system configuration");
  }

  const payload = (await response.json()) as { isCloud?: unknown };
  return {
    isCloud: payload.isCloud === true,
  };
}

/** Reads deployment mode from the server so the web image is deployment-agnostic. */
export function useSystemConfig() {
  const query = useQuery({
    queryKey: ["system-config"],
    queryFn: fetchSystemConfig,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });

  return {
    ...query,
    isCloud: query.data?.isCloud === true,
  };
}
