"use client";

import dynamic from "next/dynamic";
import { CreateOrganizationDialog } from "@/components/auth/organization/create-organization-dialog";

const UpGalChat = dynamic(
  () => import("@/components/upgal-chat").then((module) => module.UpGalChat),
  { ssr: false },
);
const UpGalGuideOverlay = dynamic(
  () =>
    import("@/components/upgal-guide-overlay").then(
      (module) => module.UpGalGuideOverlay,
    ),
  { ssr: false },
);
const SettingsDialog = dynamic(
  () => import("@/features/settings").then((module) => module.SettingsDialog),
  { ssr: false },
);

export function DashboardSharedFeatures({
  organizationId,
  pageTitle,
  createOrganizationOpen,
  onCreateOrganizationOpenChange,
}: {
  organizationId?: string;
  pageTitle?: string;
  createOrganizationOpen: boolean;
  onCreateOrganizationOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <CreateOrganizationDialog
        open={createOrganizationOpen}
        onOpenChange={onCreateOrganizationOpenChange}
      />
      <SettingsDialog />
      <UpGalChat organizationId={organizationId} pageTitle={pageTitle} />
      <UpGalGuideOverlay />
    </>
  );
}
