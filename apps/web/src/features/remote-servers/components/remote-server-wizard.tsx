"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { ServerType } from "@upstand/domain";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@upstand/ui/components/alert";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Checkbox } from "@upstand/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@upstand/ui/components/progress";
import { RadioGroup, RadioGroupItem } from "@upstand/ui/components/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { Textarea } from "@upstand/ui/components/textarea";
import { cn } from "@upstand/ui/lib/utils";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2,
  CheckIcon,
  ClockIcon,
  Copy,
  Cpu,
  ExternalLinkIcon,
  GlobeIcon,
  Info,
  KeyRound,
  PlusIcon,
  RefreshCw,
  ServerIcon,
  ShieldCheck,
  Sparkles,
  TerminalIcon,
} from "@/components/huge-icons";
import { copyText } from "@/lib/browser";
import { trpc } from "@/utils/trpc";

interface RemoteServerWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onComplete?: (serverId: string) => void;
}

function dockerSwarmState(value: unknown): string {
  if (typeof value !== "object" || value === null || !("swarmState" in value)) {
    return "active";
  }
  return typeof value.swarmState === "string" ? value.swarmState : "active";
}

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

const SUPPORTED_DISTROS = [
  { name: "Ubuntu 24.04 LTS", note: "Recommended" },
  { name: "Ubuntu 22.04 LTS", note: "Stable" },
  { name: "Ubuntu 20.04 LTS", note: "Supported" },
  { name: "Debian 12 (Bookworm)", note: "Recommended" },
  { name: "Debian 11 (Bullseye)", note: "Supported" },
  { name: "Fedora 38+", note: "Supported" },
  { name: "Rocky Linux 9 / Alma 9", note: "Enterprise" },
];

const VPS_PROVIDERS = [
  {
    name: "Hostinger",
    badge: "Recommended",
    description: "High performance VPS hosting starting from $4.99/mo.",
    link: "https://www.hostinger.com/vps-hosting",
  },
  {
    name: "DigitalOcean",
    badge: "Cloud Droplets",
    description: "Cloud instances with instant provisioning and clean API.",
    link: "https://www.digitalocean.com/",
  },
  {
    name: "Hetzner Cloud",
    badge: "Best Value",
    description: "Ultra fast NVMe cloud servers in Europe & US.",
    link: "https://www.hetzner.com/cloud/",
  },
  {
    name: "Vultr",
    badge: "High Frequency",
    description: "High-performance compute instances worldwide.",
    link: "https://www.vultr.com/",
  },
  {
    name: "Linode / Akamai",
    badge: "Developer Cloud",
    description: "Reliable cloud infrastructure with simple pricing.",
    link: "https://www.linode.com/",
  },
  {
    name: "AWS Lightsail",
    badge: "Amazon Cloud",
    description: "Simplified virtual private servers on AWS network.",
    link: "https://aws.amazon.com/lightsail/",
  },
];

export function RemoteServerWizard({
  open,
  onOpenChange,
  organizationId,
  onComplete,
}: RemoteServerWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);

  // SSH Key selection & option
  const [sshOption, setSshOption] = useState<"manual" | "provider">("manual");
  const [selectedSshKeyId, setSelectedSshKeyId] = useState<string>("");

  // Server Form State
  const [name, setName] = useState("My First Server");
  const [description, setDescription] = useState("Production remote server");
  const [serverType, setServerType] = useState<ServerType>("deploy");
  const [ipAddress, setIpAddress] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("root");
  const [enableDockerCleanup, setEnableDockerCleanup] = useState(false);

  // Created server reference
  const [createdServerId, setCreatedServerId] = useState<string | null>(null);

  // Queries
  const { data: sshKeys, refetch: refetchSshKeys } = useQuery({
    ...trpc.sshKey.list.queryOptions({ organizationId }),
    enabled: Boolean(organizationId && open),
  });

  const { refetch: refetchServers } = useQuery({
    ...trpc.server.list.queryOptions({ organizationId }),
    enabled: Boolean(organizationId && open),
  });

  // Mutations
  const generateSshKeyMutation = useMutation({
    ...trpc.sshKey.generate.mutationOptions(),
    onSuccess: (newKey) => {
      toast.success(`Generated SSH Key "${newKey.name}"`);
      refetchSshKeys();
      setSelectedSshKeyId(newKey.id);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to generate SSH key");
    },
  });

  const scanHostKeyMutation = useMutation({
    ...trpc.server.scanHostKey.mutationOptions(),
  });

  const createServerMutation = useMutation({
    ...trpc.server.create.mutationOptions(),
    onSuccess: (newServer) => {
      toast.success("Server details saved!");
      setCreatedServerId(newServer.id);
      refetchServers();
      setStep(4);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to save server connection details");
    },
  });

  const setupServerMutation = useMutation({
    ...trpc.server.setup.mutationOptions(),
    onSuccess: () => {
      toast.success("Server setup completed successfully!");
      refetchServers();
    },
    onError: (err) => {
      toast.error(err.message || "Server setup encountered an issue");
      refetchServers();
    },
  });

  // Validation queries for Step 5
  const validateQuery = useQuery({
    ...trpc.server.validate.queryOptions({
      organizationId,
      serverId: createdServerId || "",
    }),
    enabled: Boolean(organizationId && createdServerId && step === 5),
  });

  const hostTimeQuery = useQuery({
    ...trpc.server.time.queryOptions({
      organizationId,
      serverId: createdServerId || "",
    }),
    enabled: Boolean(organizationId && createdServerId && step === 5),
  });

  const runtimeStatsQuery = useQuery({
    ...trpc.server.runtimeStats.queryOptions({
      organizationId,
      serverId: createdServerId || "",
    }),
    enabled: Boolean(organizationId && createdServerId && step === 5),
  });

  // Selected SSH Key object
  const activeSshKey =
    sshKeys?.find((k) => k.id === selectedSshKeyId) || sshKeys?.[0];

  // Auto-select first key if available and none selected
  useEffect(() => {
    if (sshKeys && sshKeys.length > 0 && !selectedSshKeyId) {
      setSelectedSshKeyId(sshKeys[0].id);
    }
  }, [sshKeys, selectedSshKeyId]);

  // Handle auto setup trigger when entering step 4
  useEffect(() => {
    if (
      step === 4 &&
      createdServerId &&
      !setupServerMutation.isPending &&
      !setupServerMutation.isSuccess &&
      !setupServerMutation.isError
    ) {
      setupServerMutation.mutate({ id: createdServerId });
    }
  }, [step, createdServerId, setupServerMutation]);

  const handleGenerateKey = () => {
    generateSshKeyMutation.mutate({
      organizationId,
      name: `Onboarding Key (${new Date().toLocaleDateString()})`,
      description: "Auto-generated during remote server onboarding",
    });
  };

  const handleConnectSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a server name");
      return;
    }
    if (!ipAddress.trim()) {
      toast.error("Please enter your server IP address");
      return;
    }
    if (!selectedSshKeyId && !activeSshKey?.id) {
      toast.error("Please select or generate an SSH key in Step 2");
      return;
    }

    toast.loading("Scanning remote server SSH host key...", {
      id: "host-key-scan",
    });

    scanHostKeyMutation.mutate(
      {
        organizationId,
        ipAddress: ipAddress.trim(),
        port,
      },
      {
        onSuccess: (data) => {
          toast.success(
            `Trusted host key fingerprint (${data.algorithm}): ${data.fingerprint}`,
            { id: "host-key-scan" },
          );

          createServerMutation.mutate({
            organizationId,
            name: name.trim(),
            description: description.trim() || null,
            serverType,
            sshKeyId: selectedSshKeyId || activeSshKey?.id || "",
            ipAddress: ipAddress.trim(),
            port,
            username: username.trim() || "root",
            enableDockerCleanup,
            sshHostKeyFingerprint: data.fingerprint,
          });
        },
        onError: (err) => {
          toast.error(
            `Could not retrieve server SSH host key: ${err.message || "Connection refused"}. Please check if the IP and SSH port are correct and try again.`,
            { id: "host-key-scan", duration: 6000 },
          );
        },
      },
    );
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const stepTitles = [
    { num: 1, title: "Requisites", sub: "OS & Providers" },
    { num: 2, title: "SSH Key", sub: "Auth Setup" },
    { num: 3, title: "Connect", sub: "Server Info" },
    { num: 4, title: "Setup", sub: "Docker Provisioning" },
    { num: 5, title: "Verify", sub: "Health Check" },
    { num: 6, title: "Complete", sub: "Ready" },
  ];

  const manualAuthSnippet = activeSshKey?.publicKey
    ? `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${activeSshKey.publicKey.trim()}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
    : "# Generate or select an SSH key above to view authorization snippet";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl lg:max-w-6xl">
        {/* Wizard Header Bar */}
        <div className="shrink-0 border-border border-b bg-muted/30 px-4 pt-5 pb-4 sm:px-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ServerIcon className="size-5" />
                </div>
                <DialogTitle className="truncate font-bold text-lg tracking-tight sm:text-xl">
                  Remote Server Onboarding
                </DialogTitle>
              </div>
              <Badge variant="outline" className="shrink-0 font-medium text-xs">
                Step {step} of 6
              </Badge>
            </div>
            <DialogDescription className="line-clamp-1 text-muted-foreground text-xs">
              Connect, provision, and verify your virtual private server.
            </DialogDescription>
          </div>

          {/* Compact Mobile Progress Indicator */}
          <div className="mt-4 space-y-1.5 sm:hidden">
            <div className="flex items-center justify-between font-medium text-muted-foreground text-xs">
              <span>{stepTitles[step - 1].title}</span>
              <span>{Math.round((step / 6) * 100)}%</span>
            </div>
            <Progress value={(step / 6) * 100}>
              <ProgressTrack>
                <ProgressIndicator />
              </ProgressTrack>
            </Progress>
          </div>

          {/* Desktop Responsive Stepper Bar */}
          <nav aria-label="Wizard Steps" className="mt-5 hidden sm:block">
            <ol className="flex items-center justify-between gap-1.5">
              {stepTitles.map((s, idx) => {
                const isActive = step === s.num;
                const isPassed = step > s.num;
                return (
                  <div
                    key={s.num}
                    className="flex flex-1 items-center last:flex-initial"
                  >
                    <li
                      onClick={() => {
                        if (s.num < step || (s.num <= 3 && !createdServerId)) {
                          setStep(s.num as WizardStep);
                        }
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 transition-all",
                        isActive
                          ? "opacity-100"
                          : isPassed
                            ? "opacity-90 hover:opacity-100"
                            : "opacity-40",
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-full font-bold text-xs transition-all",
                          isActive
                            ? "bg-primary text-primary-foreground shadow-md ring-4 ring-primary/20"
                            : isPassed
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {isPassed ? <CheckIcon className="size-4" /> : s.num}
                      </div>
                      <div className="flex flex-col text-left">
                        <span className="font-semibold text-[11px] text-foreground leading-none">
                          {s.title}
                        </span>
                        <span className="mt-0.5 font-medium text-[9px] text-muted-foreground leading-none">
                          {s.sub}
                        </span>
                      </div>
                    </li>
                    {idx < stepTitles.length - 1 && (
                      <div
                        className={cn(
                          "mx-2 h-0.5 flex-1 transition-colors",
                          isPassed ? "bg-primary/50" : "bg-border/30",
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </ol>
          </nav>
        </div>

        {/* Wizard Content Body */}
        <div className="flex-1 overflow-y-auto p-4 text-foreground sm:p-6">
          {/* STEP 1: REQUISITES */}
          {step === 1 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              <div className="flex flex-col gap-1">
                <h3 className="flex items-center gap-2 font-bold text-base text-foreground sm:text-lg">
                  <ShieldCheck className="size-5 text-primary" />
                  1. Server Requisites & VPS Providers
                </h3>
                <FieldDescription>
                  Ensure you have acquired a virtual private server (VPS)
                  running a clean Linux distribution with root or sudo access.
                </FieldDescription>
              </div>

              {/* Supported Linux Distros */}
              <Card>
                <CardHeader className="p-4 pb-2">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle className="flex items-center gap-2 font-semibold text-sm">
                      <TerminalIcon className="size-4 text-primary" />
                      Supported Operating Systems
                    </CardTitle>
                    <Badge variant="secondary" className="w-fit text-[10px]">
                      x86_64 & ARM64 Supported
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    {SUPPORTED_DISTROS.map((d) => (
                      <div
                        key={d.name}
                        className="flex flex-col justify-between rounded-lg border bg-muted/40 p-3 text-xs"
                      >
                        <span className="font-medium text-foreground">
                          {d.name}
                        </span>
                        <span className="mt-1 text-[11px] text-muted-foreground">
                          {d.note}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Recommended VPS Providers */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-foreground text-sm">
                    <GlobeIcon className="size-4 text-primary" />
                    Tested VPS Hosting Providers
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Direct provider links
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {VPS_PROVIDERS.map((provider) => (
                    <a
                      key={provider.name}
                      href={provider.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex flex-col justify-between rounded-xl border bg-card p-4 transition-all hover:border-primary/50 hover:bg-muted/30"
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-foreground text-sm transition-colors group-hover:text-primary">
                            {provider.name}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {provider.badge}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-xs leading-normal">
                          {provider.description}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center justify-end font-medium text-primary text-xs">
                        Visit Site{" "}
                        <ExternalLinkIcon className="ml-1 size-3.5" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>

              <Alert variant="default">
                <Info data-icon="inline-start" />
                <AlertTitle>Firewall Notice</AlertTitle>
                <AlertDescription>
                  Upstand supports any VPS provider. Make sure your cloud
                  firewall allows inbound traffic on SSH (port 22) and web
                  traffic (ports 80 & 443).
                </AlertDescription>
              </Alert>
            </motion.div>
          )}

          {/* STEP 2: SSH KEY */}
          {step === 2 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              <div className="flex flex-col gap-1">
                <h3 className="flex items-center gap-2 font-bold text-base text-foreground sm:text-lg">
                  <KeyRound className="size-5 text-primary" />
                  2. SSH Key Authorization
                </h3>
                <FieldDescription>
                  Select or generate an SSH key pair to grant Upstand secure
                  access to your server.
                </FieldDescription>
              </div>

              {/* SSH Key Selection / Generation Card */}
              <Card>
                <CardHeader className="p-4 pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <CardTitle className="font-semibold text-sm">
                        Active SSH Key Pair
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Choose an existing key or generate a new key pair.
                      </CardDescription>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        items={(sshKeys ?? []).map((k) => ({
                          value: k.id,
                          label: `${k.name} (${k.algorithm})`,
                        }))}
                        value={selectedSshKeyId || (sshKeys?.[0]?.id ?? "")}
                        onValueChange={(val) => setSelectedSshKeyId(val || "")}
                      >
                        <SelectTrigger className="w-full sm:w-[220px]">
                          <SelectValue placeholder="Choose SSH Key" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {sshKeys?.map((k) => (
                              <SelectItem key={k.id} value={k.id}>
                                {k.name} ({k.algorithm})
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleGenerateKey}
                        disabled={generateSshKeyMutation.isPending}
                      >
                        {generateSshKeyMutation.isPending ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <PlusIcon data-icon="inline-start" />
                        )}
                        Generate Key
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {activeSshKey && (
                  <CardContent className="p-4 pt-0">
                    <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <KeyRound className="size-4 shrink-0 text-primary" />
                        <span className="truncate font-medium text-foreground">
                          {activeSshKey.name}
                        </span>
                        <span className="text-muted-foreground">
                          ({activeSshKey.algorithm})
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className="shrink-0 font-mono text-[10px]"
                      >
                        {activeSshKey.fingerprint?.slice(0, 16)}…
                      </Badge>
                    </div>
                  </CardContent>
                )}
              </Card>

              {/* Radio options for Manual vs Provider setup */}
              <FieldGroup>
                <FieldLabel>Key Installation Method</FieldLabel>
                <RadioGroup
                  value={sshOption}
                  onValueChange={(val) =>
                    setSshOption(val as "manual" | "provider")
                  }
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                  <label
                    htmlFor="opt-manual"
                    className={cn(
                      "flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-4 transition-all",
                      sshOption === "manual"
                        ? "border-primary ring-2 ring-primary/20"
                        : "border-border hover:border-border/80",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-semibold text-foreground text-sm">
                        <TerminalIcon className="size-4 text-primary" />
                        Option A: Manual Command
                      </span>
                      <RadioGroupItem value="manual" id="opt-manual" />
                    </div>
                    <p className="text-muted-foreground text-xs leading-normal">
                      Copy and run a single bash command in your VPS terminal to
                      authorize Upstand.
                    </p>
                  </label>

                  <label
                    htmlFor="opt-provider"
                    className={cn(
                      "flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-4 transition-all",
                      sshOption === "provider"
                        ? "border-primary ring-2 ring-primary/20"
                        : "border-border hover:border-border/80",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-semibold text-foreground text-sm">
                        <GlobeIcon className="size-4 text-primary" />
                        Option B: Provider Dashboard
                      </span>
                      <RadioGroupItem value="provider" id="opt-provider" />
                    </div>
                    <p className="text-muted-foreground text-xs leading-normal">
                      Copy the Public SSH Key and paste it into Hostinger,
                      DigitalOcean, or Hetzner creation menu.
                    </p>
                  </label>
                </RadioGroup>
              </FieldGroup>

              {/* Display snippet based on selected option */}
              {sshOption === "manual" ? (
                <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-semibold text-foreground text-xs">
                      <TerminalIcon className="size-4 text-primary" />
                      Run on VPS Terminal:
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (activeSshKey?.publicKey) {
                          copyText(manualAuthSnippet);
                          toast.success("Command copied to clipboard!");
                        } else {
                          toast.error("No SSH key selected");
                        }
                      }}
                    >
                      <Copy data-icon="inline-start" />
                      Copy Command
                    </Button>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border bg-background p-3 font-mono text-foreground text-xs leading-relaxed">
                    {manualAuthSnippet}
                  </pre>
                  <ol className="list-inside list-decimal space-y-1 text-muted-foreground text-xs">
                    <li>
                      Log into your server:{" "}
                      <code className="font-mono text-foreground">
                        ssh root@&lt;YOUR_SERVER_IP&gt;
                      </code>
                    </li>
                    <li>Paste and execute the command above.</li>
                  </ol>
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground text-xs">
                      Public Key
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (activeSshKey?.publicKey) {
                          copyText(activeSshKey.publicKey);
                          toast.success("Public Key copied to clipboard!");
                        } else {
                          toast.error("No SSH key selected");
                        }
                      }}
                    >
                      <Copy data-icon="inline-start" />
                      Copy Public Key
                    </Button>
                  </div>
                  <Textarea
                    readOnly
                    value={activeSshKey?.publicKey || "No public key available"}
                    className="h-24 resize-none bg-background font-mono text-xs leading-relaxed"
                  />
                  <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-muted-foreground text-xs">
                      Paste this key into your cloud provider's SSH keys
                      settings.
                    </p>
                    <a
                      href="https://docs.dokploy.com/docs/core/remote-servers/instructions#requirements"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex shrink-0 items-center gap-1 font-medium text-primary text-xs hover:underline"
                    >
                      View Tutorial Docs{" "}
                      <ExternalLinkIcon className="size-3.5" />
                    </a>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* STEP 3: CONNECT */}
          {step === 3 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              <div className="flex flex-col gap-1">
                <h3 className="flex items-center gap-2 font-bold text-base text-foreground sm:text-lg">
                  <ServerIcon className="size-5 text-primary" />
                  3. Connection & Credentials
                </h3>
                <FieldDescription>
                  Enter your server network address, role, and SSH port details.
                </FieldDescription>
              </div>

              <form id="wiz-connect-form" onSubmit={handleConnectSubmit}>
                <FieldGroup>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="wiz-name">Server Name *</FieldLabel>
                      <Input
                        id="wiz-name"
                        required
                        placeholder="Primary Production Host"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="wiz-type">Server Role</FieldLabel>
                      <Select
                        items={[
                          {
                            value: "deploy",
                            label: "Deploy Server (Swarm & Routing)",
                          },
                          {
                            value: "build",
                            label: "Build Server (Docker Compiler)",
                          },
                          {
                            value: "database",
                            label: "Database Server (Isolated DB Host)",
                          },
                        ]}
                        value={serverType}
                        onValueChange={(val) =>
                          val && setServerType(val as ServerType)
                        }
                      >
                        <SelectTrigger id="wiz-type">
                          <SelectValue placeholder="Select server role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="deploy">
                              Deploy Server (Swarm & Routing)
                            </SelectItem>
                            <SelectItem value="build">
                              Build Server (Docker Compiler)
                            </SelectItem>
                            <SelectItem value="database">
                              Database Server (Isolated DB Host)
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldDescription className="text-xs">
                        {serverType === "build"
                          ? "Build servers handle compilation and build processes, offloading work from deployment servers. Build servers will not appear in deployment options."
                          : serverType === "database"
                            ? "Database servers are dedicated hosts optimized for database engines."
                            : "Deploy servers run your applications, databases, and container services."}
                      </FieldDescription>
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="wiz-desc">
                      Description (Optional)
                    </FieldLabel>
                    <Input
                      id="wiz-desc"
                      placeholder="e.g. Hostinger VPS 4GB RAM 2vCPU"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor="wiz-ip">
                        IP Address or Host *
                      </FieldLabel>
                      <Input
                        id="wiz-ip"
                        required
                        placeholder="e.g. 195.201.45.120 or vps.example.com"
                        value={ipAddress}
                        onChange={(e) => setIpAddress(e.target.value)}
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="wiz-port">SSH Port</FieldLabel>
                      <Input
                        id="wiz-port"
                        type="number"
                        required
                        placeholder="22"
                        value={port}
                        onChange={(e) => setPort(Number(e.target.value))}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="wiz-user">SSH Username</FieldLabel>
                      <Input
                        id="wiz-user"
                        required
                        placeholder="root"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </Field>

                    <Field>
                      <FieldLabel>SSH Key Selected</FieldLabel>
                      <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 font-medium text-foreground text-xs">
                        <KeyRound className="mr-2 size-3.5 shrink-0 text-primary" />
                        <span className="truncate">
                          {activeSshKey?.name || "None"}
                        </span>
                      </div>
                    </Field>
                  </div>

                  <Field orientation="horizontal" className="pt-2">
                    <Checkbox
                      id="wiz-cleanup"
                      checked={enableDockerCleanup}
                      onCheckedChange={(val) =>
                        setEnableDockerCleanup(Boolean(val))
                      }
                    />
                    <FieldLabel
                      htmlFor="wiz-cleanup"
                      className="cursor-pointer font-normal text-muted-foreground text-xs"
                    >
                      Enable automatic daily Docker system prune & cleanup
                    </FieldLabel>
                  </Field>
                </FieldGroup>
              </form>
            </motion.div>
          )}

          {/* STEP 4: SETUP SERVER PROCESS */}
          {step === 4 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              <div className="flex flex-col gap-1">
                <h3 className="flex items-center gap-2 font-bold text-base text-foreground sm:text-lg">
                  <TerminalIcon className="size-5 text-primary" />
                  4. Setup & Docker Provisioning
                </h3>
                <FieldDescription>
                  Upstand is connecting to <strong>{name || ipAddress}</strong>,
                  installing Docker, and configuring Swarm overlay.
                </FieldDescription>
              </div>

              <Card>
                <CardHeader className="border-b p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                        {setupServerMutation.isPending ? (
                          <Spinner className="text-primary" />
                        ) : setupServerMutation.isSuccess ? (
                          <CheckCircle2 className="size-5 text-primary" />
                        ) : (
                          <AlertTriangleIcon className="size-5 text-destructive" />
                        )}
                      </div>
                      <div className="flex flex-col">
                        <CardTitle className="font-semibold text-sm">
                          {setupServerMutation.isPending
                            ? "Provisioning Server Environment..."
                            : setupServerMutation.isSuccess
                              ? "Server Provisioned Successfully!"
                              : "Setup Requires Attention"}
                        </CardTitle>
                        <CardDescription className="font-mono text-xs">
                          {ipAddress}:{port} ({username})
                        </CardDescription>
                      </div>
                    </div>

                    <Badge
                      variant={
                        setupServerMutation.isSuccess
                          ? "default"
                          : setupServerMutation.isError
                            ? "destructive"
                            : "outline"
                      }
                      className="w-fit"
                    >
                      {setupServerMutation.isPending
                        ? "In Progress"
                        : setupServerMutation.isSuccess
                          ? "Provisioned"
                          : "Failed"}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-3 p-4 text-xs">
                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
                    <span className="font-medium text-foreground">
                      1. Validate SSH Auth Key
                    </span>
                    <CheckCircle2 className="size-4 text-primary" />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
                    <span className="font-medium text-foreground">
                      2. Install Docker Engine Daemon
                    </span>
                    {setupServerMutation.isPending ? (
                      <Spinner />
                    ) : setupServerMutation.isSuccess ? (
                      <CheckCircle2 className="size-4 text-primary" />
                    ) : (
                      <span className="font-semibold text-destructive">
                        Error
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
                    <span className="font-medium text-foreground">
                      3. Initialize Swarm & Overlay Network
                    </span>
                    {setupServerMutation.isPending ? (
                      <Spinner />
                    ) : setupServerMutation.isSuccess ? (
                      <CheckCircle2 className="size-4 text-primary" />
                    ) : (
                      <span className="font-semibold text-destructive">
                        Error
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
                    <span className="font-medium text-foreground">
                      4. Deploy Routing & Agent Containers
                    </span>
                    {setupServerMutation.isPending ? (
                      <Spinner />
                    ) : setupServerMutation.isSuccess ? (
                      <CheckCircle2 className="size-4 text-primary" />
                    ) : (
                      <span className="font-semibold text-destructive">
                        Error
                      </span>
                    )}
                  </div>

                  {setupServerMutation.isError && (
                    <Alert variant="destructive" className="mt-2">
                      <AlertTriangleIcon />
                      <AlertTitle>Setup Error</AlertTitle>
                      <AlertDescription className="break-words">
                        {setupServerMutation.error.message}
                      </AlertDescription>
                    </Alert>
                  )}

                  {setupServerMutation.isSuccess && (
                    <Alert variant="default" className="mt-2">
                      <CheckCircle2 data-icon="inline-start" />
                      <AlertTitle>Provisioning Complete</AlertTitle>
                      <AlertDescription>
                        Server setup finished! Click{" "}
                        <strong>Next: Verify Server</strong> to validate host
                        health.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* STEP 5: VERIFY */}
          {step === 5 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <h3 className="flex items-center gap-2 font-bold text-base text-foreground sm:text-lg">
                    <ShieldCheck className="size-5 text-primary" />
                    5. Health & Verification Check
                  </h3>
                  <FieldDescription>
                    Live health verification of Docker daemon, host clock, and
                    system metrics.
                  </FieldDescription>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    validateQuery.refetch();
                    hostTimeQuery.refetch();
                    runtimeStatsQuery.refetch();
                    toast.info("Refreshed server verification status");
                  }}
                >
                  <RefreshCw data-icon="inline-start" />
                  Refresh
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {/* Check 1: Docker Daemon */}
                <Card>
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="flex items-center gap-2 font-semibold text-xs">
                      <CheckCircle2 className="size-4 text-primary" />
                      Docker Validation
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1 p-4 pt-1 text-xs">
                    {validateQuery.isPending ? (
                      <Spinner />
                    ) : validateQuery.isError ? (
                      <p className="text-destructive">
                        {validateQuery.error.message}
                      </p>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">
                          Operational
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          Swarm: {dockerSwarmState(validateQuery.data)}
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Check 2: Time Sync */}
                <Card>
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="flex items-center gap-2 font-semibold text-xs">
                      <ClockIcon className="size-4 text-primary" />
                      Clock Sync
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1 p-4 pt-1 text-xs">
                    {hostTimeQuery.isPending ? (
                      <Spinner />
                    ) : hostTimeQuery.isError ? (
                      <p className="text-destructive">
                        {hostTimeQuery.error.message}
                      </p>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">
                          Synchronized
                        </p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          ISO: {hostTimeQuery.data?.iso?.slice(11, 19)} UTC
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Check 3: Runtime Metrics */}
                <Card>
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="flex items-center gap-2 font-semibold text-xs">
                      <Cpu className="size-4 text-primary" />
                      System Metrics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1 p-4 pt-1 text-xs">
                    {runtimeStatsQuery.isPending ? (
                      <Spinner />
                    ) : runtimeStatsQuery.isError ? (
                      <p className="text-muted-foreground">
                        Ready for workloads
                      </p>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">
                          CPU: {runtimeStatsQuery.data?.cpu ?? 0}% | RAM:{" "}
                          {runtimeStatsQuery.data?.memoryPercent ?? 0}%
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          Containers:{" "}
                          {runtimeStatsQuery.data?.activeContainers ?? 0} active
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Alert variant="default">
                <CheckCircle2 data-icon="inline-start" />
                <AlertTitle>Server Verified & Operational</AlertTitle>
                <AlertDescription>
                  All connection, Docker engine, clock synchronization, and
                  resource checks passed successfully.
                </AlertDescription>
              </Alert>
            </motion.div>
          )}

          {/* STEP 6: COMPLETE */}
          {step === 6 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center gap-6 py-4 text-center"
            >
              <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-8" />
              </div>

              <div className="flex max-w-md flex-col gap-2">
                <h3 className="font-bold text-foreground text-xl tracking-tight sm:text-2xl">
                  Server Onboarded Successfully! 🎉
                </h3>
                <p className="text-muted-foreground text-xs leading-relaxed sm:text-sm">
                  Your remote server <strong>{name}</strong> is live and ready
                  for application, database, and service deployments.
                </p>
              </div>

              {/* Server Summary Badge Card */}
              <Card className="w-full max-w-md text-left">
                <CardHeader className="border-b p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 font-semibold text-sm">
                      <ServerIcon className="size-4 text-primary" />
                      {name}
                    </CardTitle>
                    <Badge variant="secondary">Ready</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-2 p-4 text-muted-foreground text-xs sm:grid-cols-2">
                  <div>
                    Address:{" "}
                    <span className="font-medium font-mono text-foreground">
                      {ipAddress}:{port}
                    </span>
                  </div>
                  <div>
                    Role:{" "}
                    <span className="font-medium text-foreground capitalize">
                      {serverType}
                    </span>
                  </div>
                  <div>
                    Username:{" "}
                    <span className="font-medium text-foreground">
                      {username}
                    </span>
                  </div>
                  <div>
                    SSH Key:{" "}
                    <span className="truncate font-medium text-foreground">
                      {activeSshKey?.name}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>

        {/* Wizard Footer Navigation Bar */}
        <div className="flex shrink-0 flex-col-reverse gap-3 border-border border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            {step > 1 && step < 6 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep((s) => (s - 1) as WizardStep)}
                disabled={
                  createServerMutation.isPending ||
                  setupServerMutation.isPending
                }
                className="w-full sm:w-auto"
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Back
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {step === 1 && (
              <Button
                size="sm"
                onClick={() => setStep(2)}
                className="w-full font-semibold sm:w-auto"
              >
                Next: SSH Key Setup
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            )}

            {step === 2 && (
              <Button
                size="sm"
                onClick={() => {
                  if (!selectedSshKeyId && !activeSshKey?.id) {
                    toast.error(
                      "Please select or generate an SSH key to continue",
                    );
                    return;
                  }
                  setStep(3);
                }}
                className="w-full font-semibold sm:w-auto"
              >
                Next: Connection Details
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            )}

            {step === 3 && (
              <Button
                type="submit"
                form="wiz-connect-form"
                size="sm"
                disabled={createServerMutation.isPending}
                className="w-full font-semibold sm:w-auto"
              >
                {createServerMutation.isPending ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Saving...
                  </>
                ) : (
                  <>
                    Save & Provision Server
                    <ArrowRightIcon data-icon="inline-end" />
                  </>
                )}
              </Button>
            )}

            {step === 4 && (
              <div className="flex w-full items-center gap-2 sm:w-auto">
                {setupServerMutation.isError && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      createdServerId &&
                      setupServerMutation.mutate({ id: createdServerId })
                    }
                    disabled={setupServerMutation.isPending}
                  >
                    Retry Setup
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => setStep(5)}
                  disabled={setupServerMutation.isPending}
                  className="w-full font-semibold sm:w-auto"
                >
                  Next: Verify Server
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </div>
            )}

            {step === 5 && (
              <Button
                size="sm"
                onClick={() => setStep(6)}
                className="w-full font-semibold sm:w-auto"
              >
                Complete Onboarding
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            )}

            {step === 6 && (
              <Button
                size="sm"
                onClick={() => {
                  if (createdServerId && onComplete) {
                    onComplete(createdServerId);
                  }
                  handleClose();
                }}
                className="w-full font-semibold sm:w-auto"
              >
                Finish & Go to Dashboard
                <CheckIcon data-icon="inline-end" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
