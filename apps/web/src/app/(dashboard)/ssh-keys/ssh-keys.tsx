"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getUpGalTargetDefinition } from "@upstand/api/ai/upgal-ui-targets";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@upstand/ui/components/tabs";
import { Textarea } from "@upstand/ui/components/textarea";
import { cn } from "@upstand/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { CardGridSkeleton } from "@/components/dashboard/page-skeleton";
import {
  AlertTriangleIcon,
  CheckCircle2,
  Copy,
  Edit2,
  KeyRound,
  PlusIcon,
  Trash2Icon,
} from "@/components/huge-icons";
import { UpGalTarget } from "@/components/upgal-target";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import type { authClient } from "@/lib/auth-client";
import { copyText } from "@/lib/browser";
import { trpc } from "@/utils/trpc";

const createSshKeyTarget = getUpGalTargetDefinition("create-ssh-key");
const generateNewSshKeyTarget = getUpGalTargetDefinition(
  "generate-new-ssh-key",
);
const useExistingSshKeyTarget = getUpGalTargetDefinition(
  "use-existing-ssh-key",
);
const sshKeyNameTarget = getUpGalTargetDefinition("ssh-key-name");
const sshKeyDescriptionTarget = getUpGalTargetDefinition("ssh-key-description");
const sshKeyPrivateKeyTarget = getUpGalTargetDefinition("ssh-key-private-key");
const sshKeyPublicKeyTarget = getUpGalTargetDefinition("ssh-key-public-key");
const generateSshKeySubmitTarget = getUpGalTargetDefinition(
  "generate-ssh-key-submit",
);
const importSshKeySubmitTarget = getUpGalTargetDefinition(
  "import-ssh-key-submit",
);

type AddKeyMode = "generate" | "import";

interface RevealedKey {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  privateKey: string;
}

export default function SSHKeys(_props: {
  session: typeof authClient.$Infer.Session;
}) {
  const organizationState = useRequiredActiveOrganization();
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [addKeyMode, setAddKeyMode] = useState<AddKeyMode>("generate");
  const [deleteKeyOpen, setDeleteKeyOpen] = useState(false);
  const [editKeyOpen, setEditKeyOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [selectedKey, setSelectedKey] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [revealedKey, setRevealedKey] = useState<RevealedKey | null>(null);
  const [privateKeyCopied, setPrivateKeyCopied] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [algorithm, setAlgorithm] = useState<"ed25519" | "rsa">("ed25519");
  const [privateKey, setPrivateKey] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [rotationPrivateKey, setRotationPrivateKey] = useState("");
  const [rotationPublicKey, setRotationPublicKey] = useState("");

  const orgId = organizationState.organizationId as string;

  const resetForm = () => {
    setName("");
    setDescription("");
    setAlgorithm("ed25519");
    setPrivateKey("");
    setPublicKey("");
  };

  const resetEditForm = () => {
    setEditingKey(null);
    setEditName("");
    setEditDescription("");
    setRotationPrivateKey("");
    setRotationPublicKey("");
  };

  // List SSH Keys
  const {
    data: keys,
    isLoading: loadingKeys,
    refetch,
  } = useQuery({
    ...trpc.sshKey.list.queryOptions({ organizationId: orgId }),
    enabled: organizationState.status === "ready",
  });

  // Generate SSH Key mutation (server generates a real ED25519 key pair)
  const generateMutation = useMutation({
    ...trpc.sshKey.generate.mutationOptions(),
    onSuccess: (result) => {
      setAddKeyOpen(false);
      resetForm();
      setRevealedKey(result);
      setPrivateKeyCopied(false);
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to generate SSH key");
    },
  });

  // Import (bring your own) SSH Key mutation
  const createMutation = useMutation({
    ...trpc.sshKey.create.mutationOptions(),
    onSuccess: () => {
      toast.success("SSH key added successfully");
      setAddKeyOpen(false);
      resetForm();
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to add SSH key");
    },
  });

  // Delete SSH Key mutation
  const deleteMutation = useMutation({
    ...trpc.sshKey.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("SSH key deleted successfully");
      setSelectedKey(null);
      setDeleteKeyOpen(false);
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete SSH key");
    },
  });

  const updateMutation = useMutation({
    ...trpc.sshKey.update.mutationOptions(),
    onSuccess: () => {
      toast.success("SSH key updated successfully");
      setEditKeyOpen(false);
      resetEditForm();
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update SSH key");
    },
  });

  const handleGenerate = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!orgId) {
      toast.error("No active organization found");
      return;
    }
    if (!name.trim()) {
      toast.error("Please give the key a name");
      return;
    }
    generateMutation.mutate({
      organizationId: orgId,
      name: name.trim(),
      description: description.trim() || undefined,
      algorithm,
    });
  };

  const handleImport = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!orgId) {
      toast.error("No active organization found");
      return;
    }
    if (!name.trim() || !privateKey.trim() || !publicKey.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    createMutation.mutate({
      organizationId: orgId,
      name: name.trim(),
      description: description.trim() || undefined,
      privateKey: privateKey.trim(),
      publicKey: publicKey.trim(),
    });
  };

  const handleCopyPrivateKey = async () => {
    if (!revealedKey) return;
    try {
      await copyText(revealedKey.privateKey);
      setPrivateKeyCopied(true);
      toast.success("Private key copied to clipboard");
    } catch {
      toast.error(
        "Couldn't copy automatically — please select and copy manually",
      );
    }
  };

  const handleUpdate = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!orgId || !editingKey) return;
    const hasPrivate = Boolean(rotationPrivateKey.trim());
    const hasPublic = Boolean(rotationPublicKey.trim());
    if (hasPrivate !== hasPublic) {
      toast.error("Provide both private and public keys to rotate the key");
      return;
    }
    updateMutation.mutate({
      id: editingKey.id,
      organizationId: orgId,
      name: editName.trim(),
      description: editDescription.trim() || null,
      ...(hasPrivate && hasPublic
        ? {
            privateKey: rotationPrivateKey.trim(),
            publicKey: rotationPublicKey.trim(),
          }
        : {}),
    });
  };

  const isSubmitting = generateMutation.isPending || createMutation.isPending;

  return (
    <DashboardPage>
      {/* Header */}
      <DashboardPageHeader
        title="SSH Keys"
        description="Create and manage SSH keys to securely access your servers and Git repositories."
        icon={<KeyRound className="size-6 text-primary" />}
        actions={
          <UpGalTarget definition={createSshKeyTarget}>
            <Button
              onClick={() => {
                resetForm();
                setAddKeyMode("generate");
                setAddKeyOpen(true);
              }}
              className="gap-2 font-medium"
            >
              <PlusIcon data-icon="inline-start" />
              Add SSH Key
            </Button>
          </UpGalTarget>
        }
      />

      {/* Main List */}
      {loadingKeys ? (
        <CardGridSkeleton count={2} className="grid gap-4 md:grid-cols-2" />
      ) : !orgId ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          Please select an organization to view SSH keys.
        </div>
      ) : keys && keys.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {keys.map((key) => (
            <Card key={key.id}>
              <CardHeader className="flex flex-row items-start justify-between">
                <div className="space-y-1">
                  <Badge variant="outline" className="uppercase">
                    {key.algorithm}
                  </Badge>
                  <CardTitle className="flex items-center gap-2 font-bold text-base">
                    {key.name}
                  </CardTitle>
                  {key.description && (
                    <CardDescription className="line-clamp-2 text-muted-foreground text-xs">
                      {key.description}
                    </CardDescription>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setEditingKey({ id: key.id, name: key.name });
                      setEditName(key.name);
                      setEditDescription(key.description ?? "");
                      setEditKeyOpen(true);
                    }}
                    aria-label={`Edit ${key.name}`}
                  >
                    <Edit2 />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setSelectedKey({ id: key.id, name: key.name });
                      setDeleteKeyOpen(true);
                    }}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Delete ${key.name}`}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="mt-1 rounded-2xl bg-muted p-3">
                  <Label className="font-bold text-[9px] text-muted-foreground uppercase tracking-widest">
                    Fingerprint
                  </Label>
                  <p className="select-all break-all pt-1 font-mono text-[10px] text-muted-foreground">
                    {key.fingerprint ?? `${key.publicKey.substring(0, 60)}...`}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <PageEmpty
          icon={KeyRound}
          title="No SSH keys yet"
          description="Add an SSH key to reuse it across Git providers, deployments, and servers."
          action={
            <UpGalTarget definition={createSshKeyTarget}>
              <Button
                onClick={() => {
                  resetForm();
                  setAddKeyMode("generate");
                  setAddKeyOpen(true);
                }}
              >
                <PlusIcon data-icon="inline-start" />
                Add SSH Key
              </Button>
            </UpGalTarget>
          }
        />
      )}

      {/* Edit SSH Key Dialog */}
      <Dialog
        open={editKeyOpen}
        onOpenChange={(open) => {
          setEditKeyOpen(open);
          if (!open) resetEditForm();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-bold text-xl">
              <Edit2 className="size-5 text-primary" />
              Edit SSH Key
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              Update metadata or rotate the key pair for {editingKey?.name}.
              Rotation replaces the stored encrypted private key.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="flex flex-col gap-4">
            <FieldGroup className="flex flex-col gap-2">
              <Field>
                <FieldLabel htmlFor="edit-key-name">Name</FieldLabel>
                <Input
                  id="edit-key-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-key-description">
                  Description
                </FieldLabel>
                <Input
                  id="edit-key-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="rotate-private-key">
                  Replacement private key
                </FieldLabel>
                <Textarea
                  id="rotate-private-key"
                  value={rotationPrivateKey}
                  onChange={(e) => setRotationPrivateKey(e.target.value)}
                  rows={4}
                  className="resize-none break-all font-mono text-xs"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rotate-public-key">
                  Replacement public key
                </FieldLabel>
                <Textarea
                  id="rotate-public-key"
                  value={rotationPublicKey}
                  onChange={(e) => setRotationPublicKey(e.target.value)}
                  rows={2}
                  className="resize-none break-all font-mono text-xs"
                />
              </Field>

              <div className="rounded-2xl border border-warning/30 bg-warning/5 p-3 text-muted-foreground text-xs">
                Leave the rotation fields empty to keep the current key. If you
                rotate, both key halves are required and will be verified.
              </div>
            </FieldGroup>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditKeyOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Spinner className="size-4" />}
                {updateMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add SSH Key Dialog */}
      <Dialog
        open={addKeyOpen}
        onOpenChange={(open) => {
          setAddKeyOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-bold text-xl">
              <KeyRound className="size-5 text-primary" />
              Add SSH Key
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              Generate a new key pair, or bring one you already have.
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={addKeyMode}
            onValueChange={(val) => setAddKeyMode(val as AddKeyMode)}
            className="flex flex-col gap-4"
          >
            <TabsList className="grid w-full grid-cols-2">
              <UpGalTarget definition={generateNewSshKeyTarget}>
                <TabsTrigger value="generate">Generate new key</TabsTrigger>
              </UpGalTarget>
              <UpGalTarget definition={useExistingSshKeyTarget}>
                <TabsTrigger value="import">Use existing key</TabsTrigger>
              </UpGalTarget>
            </TabsList>

            <TabsContent value="generate">
              <form onSubmit={handleGenerate} className="flex flex-col gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="key-name">Name</FieldLabel>
                    <UpGalTarget definition={sshKeyNameTarget}>
                      <Input
                        id="key-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. My Server Key"
                        autoComplete="off"
                        required
                      />
                    </UpGalTarget>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="key-description">
                      Description
                    </FieldLabel>
                    <UpGalTarget definition={sshKeyDescriptionTarget}>
                      <Input
                        id="key-description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Optional details about this key"
                        autoComplete="off"
                      />
                    </UpGalTarget>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="key-algorithm">Key Type</FieldLabel>
                    <Select
                      items={[
                        { value: "ed25519", label: "ED25519 (Recommended)" },
                        { value: "rsa", label: "RSA 2048-bit" },
                      ]}
                      value={algorithm}
                      onValueChange={(val) =>
                        val && setAlgorithm(val as "ed25519" | "rsa")
                      }
                    >
                      <SelectTrigger id="key-algorithm">
                        <SelectValue placeholder="Select key type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="ed25519">
                            ED25519 (Recommended)
                          </SelectItem>
                          <SelectItem value="rsa">RSA 2048-bit</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>

                <DialogFooter className="gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddKeyOpen(false)}
                  >
                    Cancel
                  </Button>
                  <UpGalTarget definition={generateSshKeySubmitTarget}>
                    <Button
                      type="submit"
                      className="gap-2 font-medium"
                      disabled={isSubmitting}
                    >
                      {generateMutation.isPending && (
                        <Spinner className="size-4" />
                      )}
                      {generateMutation.isPending
                        ? "Generating…"
                        : "Generate Key"}
                    </Button>
                  </UpGalTarget>
                </DialogFooter>
              </form>
            </TabsContent>

            <TabsContent value="import">
              <form onSubmit={handleImport} className="flex flex-col gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="key-name-import">Name</FieldLabel>
                    <UpGalTarget definition={sshKeyNameTarget}>
                      <Input
                        id="key-name-import"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Work Laptop Key"
                        autoComplete="off"
                        required
                      />
                    </UpGalTarget>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="key-desc">Description</FieldLabel>
                    <UpGalTarget definition={sshKeyDescriptionTarget}>
                      <Input
                        id="key-desc"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Used for private git access"
                        autoComplete="off"
                      />
                    </UpGalTarget>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="private-key">Private Key</FieldLabel>
                    <UpGalTarget definition={sshKeyPrivateKeyTarget}>
                      <Textarea
                        id="private-key"
                        value={privateKey}
                        onChange={(e) => setPrivateKey(e.target.value)}
                        rows={4}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----…"
                        className="resize-none break-all border border-border/40 p-3 font-mono text-xs focus:border-primary focus:outline-none"
                        required
                      />
                    </UpGalTarget>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="public-key">Public Key</FieldLabel>
                    <UpGalTarget definition={sshKeyPublicKeyTarget}>
                      <Textarea
                        id="public-key"
                        value={publicKey}
                        onChange={(e) => setPublicKey(e.target.value)}
                        rows={2}
                        placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5…"
                        className="resize-none break-all border border-border/40 p-3 font-mono text-xs focus:border-primary focus:outline-none"
                        required
                      />
                    </UpGalTarget>
                    <p className="text-[11px] text-muted-foreground">
                      We verify the private and public key actually match before
                      storing them.
                    </p>
                  </Field>
                </FieldGroup>

                <DialogFooter className="gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddKeyOpen(false)}
                  >
                    Cancel
                  </Button>
                  <UpGalTarget definition={importSshKeySubmitTarget}>
                    <Button
                      type="submit"
                      className="gap-2 font-medium"
                      disabled={isSubmitting}
                    >
                      {createMutation.isPending && (
                        <Spinner className="size-4" />
                      )}
                      {createMutation.isPending ? "Adding…" : "Add Key"}
                    </Button>
                  </UpGalTarget>
                </DialogFooter>
              </form>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Reveal generated private key Dialog (shown exactly once) */}
      <Dialog
        open={!!revealedKey}
        onOpenChange={(open) => {
          if (!open) {
            setRevealedKey(null);
            setPrivateKeyCopied(false);
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-2xl border border-primary/30 bg-card shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-bold text-xl">
              <KeyRound className="size-5 text-primary" />
              Save your private key
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              This is the only time we'll show you the private key for{" "}
              <span className="font-semibold text-foreground">
                {revealedKey?.name}
              </span>
              . Copy it now and store it somewhere safe — we only keep an
              encrypted copy and can't display it again.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <FieldGroup>
              <Field>
                <FieldLabel className="font-bold text-[9px] text-muted-foreground uppercase tracking-widest">
                  Private Key
                </FieldLabel>
                <Textarea
                  readOnly
                  value={revealedKey?.privateKey ?? ""}
                  rows={6}
                  className="select-all resize-none break-all border border-border/40 p-3 font-mono text-[10px]"
                  onFocus={(e) => e.target.select()}
                />
              </Field>

              <Field>
                <FieldLabel className="font-bold text-[9px] text-muted-foreground uppercase tracking-widest">
                  Public Key
                </FieldLabel>
                <Textarea
                  readOnly
                  value={revealedKey?.publicKey ?? ""}
                  rows={2}
                  className="select-all resize-none break-all border border-border/40 p-3 font-mono text-[10px]"
                  onFocus={(e) => e.target.select()}
                />
              </Field>
            </FieldGroup>

            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>Save your private key now</AlertTitle>
              <AlertDescription>
                Closing this dialog without saving the private key means it's
                gone for good — you'd need to generate a new key pair.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={handleCopyPrivateKey}
            >
              <CheckCircle2
                className={cn("size-4", !privateKeyCopied && "hidden")}
              />
              <Copy className={cn("size-4", privateKeyCopied && "hidden")} />
              {privateKeyCopied ? "Copied" : "Copy Private Key"}
            </Button>
            <Button
              type="button"
              className="font-medium"
              disabled={!privateKeyCopied}
              onClick={() => {
                setRevealedKey(null);
                setPrivateKeyCopied(false);
                toast.success("SSH key generated successfully");
              }}
            >
              I Saved It
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={deleteKeyOpen}
        onOpenChange={(open) => {
          setDeleteKeyOpen(open);
          if (!open) setSelectedKey(null);
        }}
        title="Delete SSH Key?"
        description={
          <>
            This will permanently delete <strong>{selectedKey?.name}</strong>.
            Any deployments that reference this key may fail. This action cannot
            be undone.
          </>
        }
        actionLabel="Delete Key"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (selectedKey) deleteMutation.mutate({ id: selectedKey.id });
        }}
      />
    </DashboardPage>
  );
}
