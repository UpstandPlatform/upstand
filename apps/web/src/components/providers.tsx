"use client";

import { organizationPlugin } from "@better-auth-ui/core/plugins";
import { AuthProvider } from "@better-auth-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@upstand/ui/components/sonner";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { authUiClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/trpc";
import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <AuthProvider
          authClient={authUiClient}
          plugins={[organizationPlugin()]}
          navigate={(options) => {
            if (options.replace) {
              router.replace(options.to as Route);
            } else {
              router.push(options.to as Route);
            }
          }}
        >
          {children}
        </AuthProvider>
        {/* <ReactQueryDevtools /> */}
      </QueryClientProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
