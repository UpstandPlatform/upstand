"use client";

import type { Passkey } from "@better-auth/passkey";
import { Delete02Icon, FingerPrintIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@upstand/ui/components/alert-dialog";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Field, FieldError, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Spinner } from "@upstand/ui/components/spinner";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { getUserFacingError } from "@/lib/error-message";
import {
  isPasskeySupported,
  normalizePasskeyName,
  PASSKEY_NAME_MAX_LENGTH,
} from "@/lib/passkey";

function passkeyLabel(passkey: Passkey): string {
  return passkey.name?.trim() || "Unnamed passkey";
}

export function PasskeysPanel() {
  const { data: session } = authClient.useSession();
  const passkeysQuery = useQuery({
    queryKey: ["auth", "passkeys", session?.user.id],
    queryFn: async () => {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error || !result.data) {
        throw new Error(
          result.error?.message ||
            result.error?.statusText ||
            "Unable to load passkeys",
        );
      }
      return result.data;
    },
    enabled: Boolean(session),
  });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [passkeyToDelete, setPasskeyToDelete] = useState<Passkey | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(isPasskeySupported());
  }, []);

  if (!session) {
    return (
      <p className="text-muted-foreground text-sm">Please sign in first.</p>
    );
  }

  const addPasskey = async () => {
    const passkeyName = normalizePasskeyName(name);
    if (!passkeyName) {
      setNameError("Enter a name so you can identify this passkey later.");
      return;
    }
    if (!supported) {
      toast.error("Passkeys are not supported by this browser.");
      return;
    }

    setNameError(null);
    setAdding(true);
    try {
      const result = await authClient.passkey.addPasskey({ name: passkeyName });
      if (result.error || !result.data) {
        toast.error(
          getUserFacingError(
            result.error?.message || result.error?.statusText,
            "Unable to add passkey",
          ),
        );
        return;
      }
      setName("");
      await passkeysQuery.refetch();
      toast.success("Passkey added");
    } catch (error) {
      toast.error(getUserFacingError(error, "Unable to add passkey"));
    } finally {
      setAdding(false);
    }
  };

  const deletePasskey = async () => {
    if (!passkeyToDelete) return;
    setDeletingId(passkeyToDelete.id);
    try {
      const result = await authClient.passkey.deletePasskey({
        id: passkeyToDelete.id,
      });
      if (result.error) {
        toast.error(
          getUserFacingError(
            result.error.message || result.error.statusText,
            "Unable to remove passkey",
          ),
        );
        return;
      }
      await passkeysQuery.refetch();
      toast.success("Passkey removed");
    } catch (error) {
      toast.error(getUserFacingError(error, "Unable to remove passkey"));
    } finally {
      setDeletingId(null);
      setPasskeyToDelete(null);
    }
  };

  const passkeys = (passkeysQuery.data ?? []) as Passkey[];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-sm">Passkeys</CardTitle>
              <CardDescription>
                Use your device biometrics, screen lock, or security key to sign
                in without a password.
              </CardDescription>
            </div>
            <Badge variant={passkeys.length > 0 ? "default" : "outline"}>
              {passkeys.length === 1
                ? "1 passkey"
                : `${passkeys.length} passkeys`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!supported && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground">
              This browser cannot create passkeys. Use a recent browser on a
              secure (HTTPS) connection, or use localhost during development.
            </p>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4">
            <Field>
              <FieldLabel htmlFor="passkey-name">Passkey name</FieldLabel>
              <Input
                id="passkey-name"
                value={name}
                maxLength={PASSKEY_NAME_MAX_LENGTH}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="e.g. MacBook Touch ID"
                autoComplete="off"
                disabled={adding || !supported}
              />
              <FieldError errors={nameError ? [{ message: nameError }] : []} />
            </Field>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={addPasskey}
                disabled={adding || !supported}
              >
                {adding ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <HugeiconsIcon
                    icon={FingerPrintIcon}
                    data-icon="inline-start"
                  />
                )}
                {adding ? "Waiting for device…" : "Add passkey"}
              </Button>
            </div>
          </div>

          {passkeysQuery.isPending ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner /> Loading passkeys…
            </div>
          ) : passkeysQuery.error ? (
            <p className="text-destructive text-sm">
              Unable to load passkeys. Refresh the page and try again.
            </p>
          ) : passkeys.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No passkeys are registered for this account yet.
            </p>
          ) : (
            <div className="flex flex-col divide-y">
              {passkeys.map((passkey) => (
                <div
                  key={passkey.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <HugeiconsIcon icon={FingerPrintIcon} />
                    </div>
                    <div className="grid min-w-0 gap-0.5 text-sm">
                      <span className="truncate font-medium">
                        {passkeyLabel(passkey)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Added {new Date(passkey.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setPasskeyToDelete(passkey)}
                    disabled={deletingId === passkey.id}
                    aria-label={`Remove ${passkeyLabel(passkey)}`}
                  >
                    {deletingId === passkey.id ? (
                      <Spinner />
                    ) : (
                      <HugeiconsIcon icon={Delete02Icon} />
                    )}
                    <span className="sr-only">Remove</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={passkeyToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingId) setPasskeyToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this passkey?</AlertDialogTitle>
            <AlertDialogDescription>
              “{passkeyToDelete ? passkeyLabel(passkeyToDelete) : "Passkey"}”
              will no longer be able to sign in to this account. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={deletePasskey}
              disabled={deletingId !== null}
            >
              {deletingId !== null && <Spinner data-icon="inline-start" />}
              Remove passkey
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
