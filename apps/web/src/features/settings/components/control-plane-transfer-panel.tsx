"use client";

import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Checkbox } from "@upstand/ui/components/checkbox";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";

type ImportMode = "merge" | "replace";

async function responseError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
    ? body.error
    : `Transfer request failed (${response.status})`;
}

export function ControlPlaneTransferPanel() {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const exportTransfer = async () => {
    if (includeSecrets && !passphrase.trim()) {
      toast.error("Enter a passphrase to encrypt the secret bundle.");
      return;
    }
    setExporting(true);
    try {
      const response = await fetch("/api/control-plane-transfer/export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeSecrets,
          ...(includeSecrets ? { passphrase } : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ??
        "upstand-control-plane.ndjson";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Control-plane export downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  const importTransfer = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const headers = new Headers({
        "Content-Type": "application/vnd.upstand.transfer+ndjson",
        "X-Upstand-Transfer-Mode": importMode,
      });
      if (passphrase.trim()) {
        headers.set("X-Upstand-Transfer-Passphrase", passphrase);
      }
      const response = await fetch("/api/control-plane-transfer/import", {
        method: "POST",
        credentials: "include",
        headers,
        body: importFile,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = (await response.json()) as {
        imported: number;
        conflicts: string[];
      };
      setConfirmImportOpen(false);
      if (result.conflicts.length > 0) {
        toast.warning(
          `Imported ${result.imported} records with ${result.conflicts.length} conflicts.`,
        );
      } else {
        toast.success(`Imported ${result.imported} records.`);
      }
      if (importMode === "replace") window.location.assign("/login");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Export control plane</CardTitle>
          <CardDescription>
            Download a checksummed, portable PostgreSQL/PGlite transfer. Live
            sessions and transient queues are intentionally excluded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2">
            <Checkbox
              id="transfer-include-secrets"
              checked={includeSecrets}
              onCheckedChange={(checked) => setIncludeSecrets(checked === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="transfer-include-secrets">
                Include encrypted credential bundle
              </Label>
              <p className="text-muted-foreground text-xs">
                Credentials are encrypted with your passphrase and re-encrypted
                with the destination installation key during import.
              </p>
            </div>
          </div>
          {includeSecrets ? (
            <div className="space-y-2">
              <Label htmlFor="transfer-export-passphrase">Passphrase</Label>
              <Input
                id="transfer-export-passphrase"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                autoComplete="new-password"
              />
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button disabled={exporting} onClick={() => void exportTransfer()}>
              {exporting ? <Spinner data-icon="inline-start" /> : null}
              Download export
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Import control plane</CardTitle>
          <CardDescription>
            Stage and verify the complete stream before an atomic merge or
            replacement. Newer, incompatible, or cloud-owned exports fail
            closed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="transfer-import-file">Transfer file</Label>
            <Input
              id="transfer-import-file"
              type="file"
              accept=".ndjson,application/vnd.upstand.transfer+ndjson"
              onChange={(event) =>
                setImportFile(event.target.files?.item(0) ?? null)
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-import-mode">Import mode</Label>
            <Select
              value={importMode}
              onValueChange={(value) => {
                if (value === "merge" || value === "replace") {
                  setImportMode(value);
                }
              }}
            >
              <SelectTrigger id="transfer-import-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="merge">
                  Merge and report conflicts
                </SelectItem>
                <SelectItem value="replace">
                  Atomically replace destination
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-import-passphrase">
              Secret bundle passphrase (if included)
            </Label>
            <Input
              id="transfer-import-passphrase"
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="rounded-lg border p-3 text-muted-foreground text-xs">
            Before cutover, verify destination readiness and backups, plan the
            DNS/proxy handoff, then redeploy restored workloads. Replacement
            invalidates current sessions and requires signing in again.
          </div>
          <div className="flex justify-end">
            <Button
              variant={importMode === "replace" ? "destructive" : "default"}
              disabled={!importFile || importing}
              onClick={() => setConfirmImportOpen(true)}
            >
              Review import
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmActionDialog
        open={confirmImportOpen}
        onOpenChange={setConfirmImportOpen}
        title={
          importMode === "replace"
            ? "Replace destination control-plane data?"
            : "Merge this control-plane transfer?"
        }
        description={
          importMode === "replace"
            ? "The verified transfer replaces portable destination data in one transaction. Current sessions are invalidated."
            : "Matching records are kept, new records are imported, and differing records are returned as conflicts."
        }
        actionLabel={importMode === "replace" ? "Replace data" : "Import data"}
        variant={importMode === "replace" ? "destructive" : "default"}
        requireConfirmText={importMode === "replace"}
        confirmText="REPLACE"
        pending={importing}
        onConfirm={() => void importTransfer()}
      />
    </div>
  );
}
