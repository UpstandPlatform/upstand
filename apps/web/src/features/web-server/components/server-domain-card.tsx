"use client";

import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
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
import { Switch } from "@upstand/ui/components/switch";
import { GlobeIcon } from "@/components/huge-icons";

export type CertificateProvider =
  | "letsencrypt"
  | "zerossl"
  | "self-signed"
  | "custom"
  | "none";

export interface CertificateOption {
  id: string;
  name: string;
  domainName?: string;
}

interface ServerDomainCardProps {
  serverDomain: string;
  setServerDomain: (domain: string) => void;
  email: string;
  setEmail: (email: string) => void;
  httpsEnabled: boolean;
  setHttpsEnabled: (enabled: boolean) => void;
  certificateProvider: CertificateProvider;
  setCertificateProvider: (provider: CertificateProvider) => void;
  certificateId?: string | null;
  setCertificateId?: (id: string | null) => void;
  certificatesList?: CertificateOption[];
  ipAccessEnabled: boolean;
  setIpAccessEnabled: (enabled: boolean) => void;
  canDisableIpAccess: boolean;
  onSave: (e: React.SyntheticEvent) => void;
  isSaving: boolean;
}

export function ServerDomainCard({
  serverDomain,
  setServerDomain,
  email,
  setEmail,
  httpsEnabled,
  setHttpsEnabled,
  certificateProvider,
  setCertificateProvider,
  certificateId,
  setCertificateId,
  certificatesList = [],
  ipAccessEnabled,
  setIpAccessEnabled,
  canDisableIpAccess,
  onSave,
  isSaving,
}: ServerDomainCardProps) {
  return (
    <form onSubmit={onSave}>
      <Card className="border border-border/40 bg-card/20 shadow-sm transition-all duration-200 hover:border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 font-semibold text-lg tracking-tight">
            <GlobeIcon className="size-5 text-primary" />
            <span>Server Domain</span>
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs">
            Add a domain and configure certificate strategy for your server
            application.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Row 1: Domain & Let's Encrypt Email */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label
                htmlFor="server-domain-input"
                className="font-medium text-xs"
              >
                Domain
              </Label>
              <Input
                id="server-domain-input"
                type="text"
                value={serverDomain}
                onChange={(e) => setServerDomain(e.target.value)}
                placeholder="e.g. upstand.dev"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="server-email-input"
                className="font-medium text-xs"
              >
                ACME Email (Optional for Let&apos;s Encrypt)
              </Label>
              <Input
                id="server-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. admin@upstand.dev (optional)"
              />
              <p className="text-[11px] text-muted-foreground">
                Optional for Let&apos;s Encrypt. ZeroSSL uses this for ACME
                registration.
              </p>
            </div>
          </div>

          {/* Row 2: HTTPS Switch Row */}
          <div className="flex items-center justify-between transition-colors hover:bg-muted/20">
            <div className="space-y-1">
              <Label
                htmlFor="https-toggle"
                className="cursor-pointer font-semibold text-foreground text-xs"
              >
                HTTPS
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Automatically provision and enforce SSL/TLS encryption.
              </p>
            </div>
            <Switch
              id="https-toggle"
              checked={httpsEnabled}
              onCheckedChange={setHttpsEnabled}
            />
          </div>

          {/* Row 3: Certificate Provider Select */}
          {httpsEnabled && (
            <div className="space-y-2">
              <Label
                htmlFor="cert-provider-select"
                className="font-medium text-xs"
              >
                Certificate Provider
              </Label>
              <Select
                value={certificateProvider}
                onValueChange={(val) =>
                  setCertificateProvider(val as CertificateProvider)
                }
              >
                <SelectTrigger id="cert-provider-select">
                  <SelectValue placeholder="Select Certificate Provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="letsencrypt">Let's Encrypt</SelectItem>
                  <SelectItem value="zerossl">ZeroSSL</SelectItem>
                  <SelectItem value="self-signed">
                    Self-Signed (Caddy CA)
                  </SelectItem>
                  <SelectItem value="custom">Custom Certificate</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Row 4: Custom Certificate Select (when provider === 'custom') */}
          {certificateProvider === "custom" && httpsEnabled && (
            <div className="space-y-2">
              <Label
                htmlFor="custom-cert-select"
                className="font-medium text-xs"
              >
                Custom Certificate
              </Label>
              <Select
                value={certificateId || ""}
                onValueChange={(val) => setCertificateId?.(val || null)}
              >
                <SelectTrigger id="custom-cert-select">
                  <SelectValue placeholder="Select an uploaded certificate" />
                </SelectTrigger>
                <SelectContent>
                  {certificatesList && certificatesList.length > 0 ? (
                    certificatesList.map((cert) => (
                      <SelectItem key={cert.id} value={cert.id}>
                        📜 {cert.name}
                        {cert.domainName ? ` (${cert.domainName})` : ""}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="_empty" disabled>
                      No custom certificates found (Infrastructure →
                      Certificates)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between border-border/40 border-t pt-4">
            <div className="space-y-1">
              <Label
                htmlFor="ip-access-toggle"
                className="cursor-pointer font-semibold text-foreground text-xs"
              >
                Direct IP:port access
              </Label>
              <p className="max-w-xl text-[11px] text-muted-foreground">
                Enabled by default so the dashboard, API, and documentation work
                before DNS is configured. Disable it only after a valid HTTPS
                domain and certificate are ready.
              </p>
              {!canDisableIpAccess && !ipAccessEnabled && (
                <p className="text-[11px] text-destructive">
                  Saving these settings will restore direct access until HTTPS
                  domain configuration is complete.
                </p>
              )}
            </div>
            <Switch
              id="ip-access-toggle"
              checked={ipAccessEnabled}
              disabled={!canDisableIpAccess}
              onCheckedChange={setIpAccessEnabled}
            />
          </div>

          {/* Row 5: Save Action Footer */}
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Spinner className="mr-2 size-3.5" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
