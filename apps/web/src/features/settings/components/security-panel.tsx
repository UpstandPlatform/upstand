import { useForm } from "@tanstack/react-form";
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
import { Separator } from "@upstand/ui/components/separator";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import z from "zod";
import { authClient } from "@/lib/auth-client";
import { useSecuritySettings } from "../hooks/use-security-settings";

export function SecurityPanel() {
  const { data: session } = authClient.useSession();
  const [regenBackupConfirmOpen, setRegenBackupConfirmOpen] = useState(false);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);

  const codeForm = useForm({
    defaultValues: {
      verifyCode: "",
    },
    onSubmit: async ({ value }) => {
      await handleConfirm(value.verifyCode);
    },
    validators: {
      onSubmit: z.object({
        verifyCode: z
          .string()
          .length(6, "Code must be exactly 6 digits")
          .regex(/^\d+$/, "Code must contain only digits"),
      }),
    },
  });

  const {
    loading,
    totpURI,
    backupCodes,
    showBackupCodes,
    setShowBackupCodes,
    handleEnable,
    handleConfirm,
    handleDisable,
    handleRegenerateBackupCodes,
    cancelSetup,
  } = useSecuritySettings(() => {
    codeForm.reset();
  });

  const enableForm = useForm({
    defaultValues: {
      password: "",
    },
    onSubmit: async ({ value }) => {
      const enabled = await handleEnable(value.password);
      if (enabled) enableForm.reset();
    },
    validators: {
      onSubmit: z.object({
        password: z.string().min(1, "Current password is required"),
      }),
    },
  });

  const disableForm = useForm({
    defaultValues: {
      password: "",
    },
    onSubmit: async () => {
      setDisableConfirmOpen(true);
    },
    validators: {
      onSubmit: z.object({
        password: z.string().min(1, "Current password is required"),
      }),
    },
  });

  if (!session) {
    return (
      <p className="text-muted-foreground text-sm">Please sign in first.</p>
    );
  }

  const extractSecret = (uri: string | null) => {
    if (!uri) return "";
    try {
      return new URL(uri).searchParams.get("secret") || "";
    } catch {
      return "";
    }
  };

  const secret = extractSecret(totpURI);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">
                Two-Factor Authentication
              </CardTitle>
              <CardDescription>
                Add an extra verification step for every sign-in.
              </CardDescription>
            </div>
            <Badge
              variant={session.user.twoFactorEnabled ? "default" : "outline"}
            >
              {session.user.twoFactorEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          {session.user.twoFactorEnabled ? (
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm">
                Your account is protected. You'll be prompted for a code from
                your authenticator app on each sign-in.
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => setRegenBackupConfirmOpen(true)}
                  >
                    {loading && <Spinner data-icon="inline-start" />}
                    Regenerate recovery codes
                  </Button>
                </div>
                <form
                  className="flex flex-col gap-3 rounded-md border border-destructive/20 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    disableForm.handleSubmit();
                  }}
                >
                  <disableForm.Field name="password">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>
                          Current password to disable 2FA
                        </FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="password"
                          autoComplete="current-password"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </disableForm.Field>
                  <div className="flex justify-end">
                    <disableForm.Subscribe
                      selector={(state) => ({
                        canSubmit: state.canSubmit,
                        password: state.values.password,
                      })}
                    >
                      {({ canSubmit, password }) => (
                        <Button
                          type="submit"
                          variant="destructive"
                          size="sm"
                          disabled={loading || !canSubmit || !password}
                        >
                          {loading && <Spinner data-icon="inline-start" />}
                          Disable 2FA
                        </Button>
                      )}
                    </disableForm.Subscribe>
                  </div>
                </form>
              </div>
            </div>
          ) : totpURI ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                codeForm.handleSubmit();
              }}
              className="flex flex-col gap-4"
            >
              <p className="text-muted-foreground text-sm">
                1. Scan this QR code in your authenticator app (Google
                Authenticator, Authy, or 1Password):
              </p>
              <div className="flex justify-center">
                {/* biome-ignore lint/performance/noImgElement: QR code is served by an external generator and must remain a direct image URL. */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(totpURI)}`}
                  alt="2FA QR Code"
                  className="rounded-md border bg-white p-2"
                />
              </div>
              {secret && (
                <p className="text-center text-muted-foreground text-xs">
                  Can't scan?{" "}
                  <code className="select-all rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {secret}
                  </code>
                </p>
              )}
              <Separator />
              <p className="text-muted-foreground text-sm">
                2. Enter the 6-digit code from your app to activate:
              </p>

              <codeForm.Field name="verifyCode">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      Verification Code
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="000000"
                      maxLength={6}
                      className="text-center font-mono tracking-widest"
                      autoFocus
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </codeForm.Field>

              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelSetup}
                >
                  Cancel
                </Button>
                <codeForm.Subscribe
                  selector={(state) => ({
                    canSubmit: state.canSubmit,
                    values: state.values,
                  })}
                >
                  {({ canSubmit, values }) => (
                    <Button
                      type="submit"
                      size="sm"
                      disabled={
                        !canSubmit || loading || values.verifyCode.length !== 6
                      }
                    >
                      {loading && <Spinner data-icon="inline-start" />}
                      Verify & Enable
                    </Button>
                  )}
                </codeForm.Subscribe>
              </div>
            </form>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                enableForm.handleSubmit();
              }}
            >
              <p className="text-muted-foreground text-sm">
                Protect your account with a time-based one-time password from
                your phone.
              </p>
              <enableForm.Field name="password">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      Current password
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="password"
                      autoComplete="current-password"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </enableForm.Field>
              <div className="flex justify-end">
                <enableForm.Subscribe
                  selector={(state) => ({
                    canSubmit: state.canSubmit,
                    password: state.values.password,
                  })}
                >
                  {({ canSubmit, password }) => (
                    <Button
                      type="submit"
                      size="sm"
                      disabled={loading || !canSubmit || !password}
                    >
                      {loading && <Spinner data-icon="inline-start" />}
                      Set Up Authenticator
                    </Button>
                  )}
                </enableForm.Subscribe>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Backup codes */}
      {showBackupCodes && backupCodes.length > 0 && (
        <Card className="border-green-600/20 bg-green-500/5 dark:border-green-500/20">
          <CardHeader>
            <CardTitle className="text-sm">Recovery Codes</CardTitle>
            <CardDescription>
              Save these codes somewhere safe. Each can only be used once.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-1.5 rounded-md border bg-muted/50 p-3 font-mono text-xs">
              {backupCodes.map((code, i) => (
                <span key={i} className="select-all">
                  {i + 1}. {code}
                </span>
              ))}
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowBackupCodes(false)}>
                I've saved these codes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Confirm Regenerate Recovery Codes */}
      <AlertDialog
        open={regenBackupConfirmOpen}
        onOpenChange={setRegenBackupConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate New Recovery Codes?</AlertDialogTitle>
            <AlertDialogDescription>
              All existing recovery codes will stop working immediately. Make
              sure to save the new codes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setRegenBackupConfirmOpen(false);
                await handleRegenerateBackupCodes();
              }}
            >
              Generate New Codes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Disable 2FA */}
      <AlertDialog
        open={disableConfirmOpen}
        onOpenChange={setDisableConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disable Two-Factor Authentication?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure? Disabling 2FA makes your account less secure.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setDisableConfirmOpen(false);
                await handleDisable(disableForm.state.values.password);
                disableForm.reset();
              }}
            >
              Disable 2FA
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
