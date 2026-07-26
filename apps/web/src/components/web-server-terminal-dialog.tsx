"use client";

import {
  ArrowRight01Icon,
  Key01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@upstand/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TerminalDialogShell } from "@/components/shared/terminal-dialog-shell";
import { authClient } from "@/lib/auth-client";
import { getServerApiUrl } from "@/lib/server-url";
import { trpc } from "@/utils/trpc";

export function WebServerTerminalDialog({
  open,
  onOpenChange,
  serverId,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  serverId?: string;
}) {
  const { data: organization } = authClient.useActiveOrganization();
  const { data: keys = [] } = useQuery({
    ...trpc.sshKey.list.queryOptions({
      organizationId: organization?.id as string,
    }),
    enabled: Boolean(organization?.id && open),
  });

  const { data: server } = useQuery({
    ...trpc.server.one.queryOptions({
      organizationId: organization?.id as string,
      id: serverId as string,
    }),
    enabled: Boolean(organization?.id && serverId && open),
  });

  const [keyId, setKeyId] = useState("");
  const [username, setUsername] = useState("root");
  const [port, setPort] = useState("22");
  const [token, setToken] = useState<string | null>(null);
  const [requestingSession, setRequestingSession] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  const connecting =
    requestingSession || Boolean(token !== null && !sessionReady);

  useEffect(() => {
    if (!open) {
      setToken(null);
      setSessionReady(false);
      setRequestingSession(false);
    }
  }, [open]);

  useEffect(() => {
    if (server) {
      setKeyId(server.sshKeyId ?? "");
      setUsername(server.username);
      setPort(String(server.port));
    } else {
      if (open && !keyId && keys.length === 1) {
        setKeyId(keys[0]?.id ?? "");
      }
    }
  }, [server, keyId, keys, open]);

  const disconnect = () => {
    setToken(null);
    setSessionReady(false);
    setRequestingSession(false);
  };

  const connect = async () => {
    if (!organization?.id) return;
    if (!serverId && !keyId) {
      toast.error("Choose an SSH key first");
      return;
    }

    const normalizedUsername = username.trim();
    const normalizedPort = Number(port);
    if (!normalizedUsername) {
      toast.error("Enter an SSH username");
      return;
    }
    if (
      !Number.isInteger(normalizedPort) ||
      normalizedPort < 1 ||
      normalizedPort > 65_535
    ) {
      toast.error("SSH port must be between 1 and 65535");
      return;
    }

    setRequestingSession(true);
    setSessionReady(false);
    try {
      const response = await fetch(getServerApiUrl("/api/terminal/session"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: organization.id,
          sshKeyId: keyId || undefined,
          username: normalizedUsername,
          port: normalizedPort,
          serverId: serverId || undefined,
        }),
      });
      const data = (await response.json()) as {
        token?: string;
        error?: string;
      };
      if (!response.ok || !data.token) {
        throw new Error(data.error || "Unable to create terminal session");
      }
      setToken(data.token);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Terminal connection failed",
      );
    } finally {
      setRequestingSession(false);
    }
  };

  return (
    <TerminalDialogShell
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) disconnect();
        onOpenChange(nextOpen);
      }}
      title={server ? `Terminal for ${server.name}` : "Control-plane terminal"}
      description={
        server
          ? `Secure SSH access to ${server.name} (${server.ipAddress}). Your private key stays encrypted on the server.`
          : "Secure SSH access to the configured control-plane server. Your private key stays encrypted on the server."
      }
      token={token}
      connecting={connecting}
      appearance="control-plane"
      terminalLabel={
        server
          ? `${username.trim() || "root"}@${server.name}`
          : `${username.trim() || "root"}@control-plane`
      }
      emptyMessage="Choose a key and confirm the SSH details to open a session."
      onTerminalReady={() => setSessionReady(true)}
      onTerminalClose={(reason) => {
        disconnect();
        if (reason === "SSH session closed") {
          toast.info(reason);
        } else if (reason) {
          toast.error(reason);
        }
      }}
      controls={
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (token) disconnect();
            else void connect();
          }}
        >
          <FieldGroup className="grid grid-cols-2 gap-4">
            <Field className="col-span-2">
              <FieldLabel htmlFor="control-plane-ssh-key">SSH key</FieldLabel>
              <Select
                items={keys.map((key) => ({
                  value: key.id,
                  label: key.name,
                }))}
                value={keyId}
                onValueChange={(value) => setKeyId(value ?? "")}
                disabled={Boolean(token)}
              >
                <SelectTrigger
                  id="control-plane-ssh-key"
                  className="w-full min-w-0"
                >
                  <HugeiconsIcon icon={Key01Icon} />
                  <SelectValue placeholder="Select an SSH key" />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {keys.map(
                      (key: {
                        id: string;
                        name: string;
                        fingerprint: string;
                      }) => (
                        <SelectItem
                          key={key.id}
                          value={key.id}
                          title={`${key.name} · ${key.fingerprint}`}
                        >
                          <span className="max-w-40 truncate sm:max-w-72">
                            {key.name}
                          </span>
                          <span className="max-w-28 truncate font-mono text-muted-foreground text-xs sm:max-w-52">
                            {key.fingerprint}
                          </span>
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field className="col-span-2 sm:col-span-1">
              <FieldLabel htmlFor="control-plane-username">Username</FieldLabel>
              <InputGroup data-disabled={Boolean(token)}>
                <InputGroupAddon>
                  <HugeiconsIcon icon={UserIcon} />
                </InputGroupAddon>
                <InputGroupInput
                  id="control-plane-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="root"
                  disabled={Boolean(token)}
                />
              </InputGroup>
            </Field>

            <Field className="col-span-2 sm:col-span-1">
              <FieldLabel htmlFor="control-plane-port">Port</FieldLabel>
              <InputGroup data-disabled={Boolean(token)}>
                <InputGroupInput
                  id="control-plane-port"
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  inputMode="numeric"
                  min={1}
                  max={65_535}
                  type="number"
                  disabled={Boolean(token)}
                />
              </InputGroup>
            </Field>

            <Field className="col-span-2 flex justify-end pt-2">
              <FieldLabel className="sr-only">Session action</FieldLabel>
              <Button
                type="submit"
                className="w-full"
                variant={
                  token ? (sessionReady ? "destructive" : "outline") : "default"
                }
                disabled={requestingSession}
              >
                {connecting ? <Spinner data-icon="inline-start" /> : null}
                {requestingSession
                  ? "Preparing…"
                  : token
                    ? sessionReady
                      ? "Disconnect"
                      : "Cancel"
                    : "Connect"}
                {!connecting && !token ? (
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    data-icon="inline-end"
                  />
                ) : null}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      }
    />
  );
}
