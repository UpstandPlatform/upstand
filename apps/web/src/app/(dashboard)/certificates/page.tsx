"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
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
import { Skeleton } from "@upstand/ui/components/skeleton";
import { Spinner } from "@upstand/ui/components/spinner";
import { Textarea } from "@upstand/ui/components/textarea";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import {
  Edit2,
  PlusIcon,
  ShieldCheck,
  Trash2Icon,
} from "@/components/huge-icons";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

type CertificateSummary = {
  id: string;
  name: string;
};

type CertificateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  certificate: CertificateSummary | null;
  onSaved: () => void;
};

function CertificateDialog({
  open,
  onOpenChange,
  organizationId,
  certificate,
  onSaved,
}: CertificateDialogProps) {
  const isEditing = certificate !== null;
  const [name, setName] = useState("");
  const [certificatePem, setCertificatePem] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");

  const createMutation = useMutation({
    ...trpc.certificate.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Certificate stored securely");
      resetForm();
      onOpenChange(false);
      onSaved();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    ...trpc.certificate.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Certificate updated");
      resetForm();
      onOpenChange(false);
      onSaved();
    },
    onError: (error) => toast.error(error.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const resetForm = () => {
    setName("");
    setCertificatePem("");
    setPrivateKeyPem("");
  };

  useEffect(() => {
    if (!open) return;

    setName(certificate?.name ?? "");
    setCertificatePem("");
    setPrivateKeyPem("");
  }, [open, certificate]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return;

    if (!nextOpen) {
      resetForm();
    }

    onOpenChange(nextOpen);
  };

  const trimmedName = name.trim();
  const trimmedCertificatePem = certificatePem.trim();
  const trimmedPrivateKeyPem = privateKeyPem.trim();

  const canSubmit = isEditing
    ? trimmedName.length > 0
    : trimmedName.length > 0 &&
      trimmedCertificatePem.length > 0 &&
      trimmedPrivateKeyPem.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-bold text-xl">
            {isEditing ? "Edit Certificate" : "Add Custom Certificate"}
          </DialogTitle>

          <DialogDescription className="text-muted-foreground text-sm">
            {isEditing
              ? "Update the certificate name or replace its PEM material. Leave either PEM field blank to keep its current encrypted value."
              : "Paste a PEM-encoded certificate and private key. Private keys are encrypted and are never returned to the browser."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();

            if (!canSubmit || !organizationId) return;

            if (certificate) {
              updateMutation.mutate({
                id: certificate.id,
                name: trimmedName,
                ...(trimmedCertificatePem
                  ? { certificatePem: trimmedCertificatePem }
                  : {}),
                ...(trimmedPrivateKeyPem
                  ? { privateKeyPem: trimmedPrivateKeyPem }
                  : {}),
              });

              return;
            }

            createMutation.mutate({
              organizationId,
              name: trimmedName,
              certificatePem: trimmedCertificatePem,
              privateKeyPem: trimmedPrivateKeyPem,
            });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="certificate-name">Name</FieldLabel>

              <Input
                id="certificate-name"
                name="certificate-name"
                autoComplete="off"
                autoFocus
                placeholder="e.g. Production wildcard certificate"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-pem">
                Certificate PEM
                {isEditing ? (
                  <span className="ml-1 font-normal text-muted-foreground">
                    (optional)
                  </span>
                ) : null}
              </FieldLabel>

              <Textarea
                id="certificate-pem"
                name="certificate-pem"
                spellCheck={false}
                autoComplete="off"
                placeholder="-----BEGIN CERTIFICATE-----"
                value={certificatePem}
                onChange={(event) => setCertificatePem(event.target.value)}
                required={!isEditing}
                rows={8}
                className="font-mono text-xs"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="private-key-pem">
                Private Key PEM
                {isEditing ? (
                  <span className="ml-1 font-normal text-muted-foreground">
                    (optional)
                  </span>
                ) : null}
              </FieldLabel>

              <Textarea
                id="private-key-pem"
                name="private-key-pem"
                spellCheck={false}
                autoComplete="off"
                placeholder="-----BEGIN PRIVATE KEY-----"
                value={privateKeyPem}
                onChange={(event) => setPrivateKeyPem(event.target.value)}
                required={!isEditing}
                rows={8}
                className="font-mono text-xs"
              />
            </Field>
          </FieldGroup>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>

            <Button
              type="submit"
              disabled={isPending || !organizationId || !canSubmit}
              className="gap-2"
            >
              {isPending ? <Spinner className="size-4" /> : null}

              {isPending
                ? isEditing
                  ? "Saving…"
                  : "Encrypting…"
                : isEditing
                  ? "Save Changes"
                  : "Store Certificate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CertificatesPage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;

  const [certificateDialogOpen, setCertificateDialogOpen] = useState(false);
  const [selectedCertificate, setSelectedCertificate] =
    useState<CertificateSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CertificateSummary | null>(
    null,
  );

  const certificatesQuery = useQuery({
    ...trpc.certificate.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });

  const deleteMutation = useMutation({
    ...trpc.certificate.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Certificate removed");
      setPendingDelete(null);
      void certificatesQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const openCreateDialog = () => {
    setSelectedCertificate(null);
    setCertificateDialogOpen(true);
  };

  const openEditDialog = (certificate: CertificateSummary) => {
    setSelectedCertificate(certificate);
    setCertificateDialogOpen(true);
  };

  const handleCertificateDialogChange = (open: boolean) => {
    setCertificateDialogOpen(open);

    if (!open) {
      setSelectedCertificate(null);
    }
  };

  return (
    <DashboardPage>
      <DashboardPageHeader
        title="Certificates"
        description="Manage encrypted custom TLS certificates for HTTPS resource domains. Private keys are never returned to the browser after creation."
        icon={<ShieldCheck className="size-6 text-primary" />}
        actions={
          <Button
            onClick={openCreateDialog}
            className="gap-2 font-medium"
            disabled={!organizationId}
          >
            <PlusIcon data-icon="inline-start" />
            Add Certificate
          </Button>
        }
      />

      <div>
        {certificatesQuery.isPending
          ? Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>

                <Skeleton className="h-8 w-16" />
              </div>
            ))
          : null}

        {!certificatesQuery.isPending && certificatesQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">
              Failed to load certificates
            </p>

            <p className="mt-1 text-muted-foreground">
              {certificatesQuery.error.message}
            </p>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void certificatesQuery.refetch()}
            >
              Try Again
            </Button>
          </div>
        ) : null}

        {(certificatesQuery.data ?? []).map((certificate) => (
          <div
            key={certificate.id}
            className="flex items-center justify-between gap-4 rounded-md border p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{certificate.name}</p>

              <p className="text-muted-foreground text-xs">
                Certificate and private key configured
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${certificate.name}`}
                onClick={() => openEditDialog(certificate)}
              >
                <Edit2 aria-hidden="true" />
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${certificate.name}`}
                onClick={() => setPendingDelete(certificate)}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}

        {!certificatesQuery.isPending &&
        !certificatesQuery.isError &&
        certificatesQuery.data?.length === 0 ? (
          <PageEmpty
            icon={ShieldCheck}
            title="No custom certificates"
            description="Add custom PEM certificates to secure your domains."
            action={
              <Button
                onClick={openCreateDialog}
                size="sm"
                className="mt-1 gap-2"
              >
                <PlusIcon data-icon="inline-start" />
                Add Certificate
              </Button>
            }
          />
        ) : null}
      </div>

      <CertificateDialog
        open={certificateDialogOpen}
        onOpenChange={handleCertificateDialogChange}
        organizationId={organizationId}
        certificate={selectedCertificate}
        onSaved={() => void certificatesQuery.refetch()}
      />

      <ConfirmActionDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setPendingDelete(null);
          }
        }}
        title="Delete Certificate?"
        description={`"${pendingDelete?.name}" will be permanently removed from Upstand and cannot be used by Caddy routes afterward.`}
        actionLabel="Delete Certificate"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) {
            deleteMutation.mutate({ id: pendingDelete.id });
          }
        }}
      />
    </DashboardPage>
  );
}
