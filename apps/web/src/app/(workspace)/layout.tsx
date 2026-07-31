import { DashboardLayout } from "@/app/(dashboard)/layout";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout variant="workspace">{children}</DashboardLayout>;
}
