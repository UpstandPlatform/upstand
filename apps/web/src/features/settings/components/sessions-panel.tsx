import { useListSessions, useRevokeSession } from "@better-auth-ui/react";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { authUiClient } from "@/lib/auth-client";

interface ActiveSession {
  id: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  updatedAt: string | Date;
  active?: boolean;
  token?: string | null;
}

function parseUA(ua: string): string {
  if (!ua) return "Unknown Browser";
  let browser = "Unknown";
  if (ua.includes("Firefox/")) browser = "Firefox";
  else if (
    ua.includes("Chrome/") &&
    !ua.includes("Chromium/") &&
    !ua.includes("Edg/")
  )
    browser = "Chrome";
  else if (ua.includes("Safari/") && !ua.includes("Chrome/"))
    browser = "Safari";
  else if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("OPR/") || ua.includes("Opera/")) browser = "Opera";

  let os = "Unknown OS";
  if (ua.includes("Windows NT 10.0")) os = "Windows 10/11";
  else if (ua.includes("Macintosh; Intel Mac OS X")) os = "macOS";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone OS") || ua.includes("iPad; CPU OS")) os = "iOS";
  else if (ua.includes("Linux")) os = "Linux";

  return `${browser} on ${os}`;
}

export function SessionsPanel() {
  const { data: sessions, refetch } = useListSessions(authUiClient);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { mutate: revokeSession } = useRevokeSession(authUiClient, {
    onSuccess: () => {
      toast.success("Session revoked");
      refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to revoke session"),
    onSettled: () => setRevokingId(null),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Active Sessions</CardTitle>
        <CardDescription>
          Devices currently signed in to your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!sessions || sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No active sessions found.
          </p>
        ) : (
          <div className="flex flex-col divide-y">
            {sessions.map((s: ActiveSession) => {
              const ip =
                !s.ipAddress ||
                ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(s.ipAddress)
                  ? "Localhost"
                  : s.ipAddress;
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
                    <span className="truncate font-medium">
                      {parseUA(s.userAgent ?? "")}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {ip} · Last active{" "}
                      {new Date(s.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  {s.active ? (
                    <Badge variant="outline">Current</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revokingId === s.id}
                      onClick={() => {
                        setRevokingId(s.id);
                        revokeSession({ token: s.token || s.id });
                      }}
                    >
                      {revokingId === s.id ? (
                        <Spinner data-icon="inline-start" />
                      ) : null}
                      Revoke
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
