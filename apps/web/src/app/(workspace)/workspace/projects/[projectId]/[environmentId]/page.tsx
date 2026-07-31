import { redirect } from "next/navigation";
import EnvironmentDetail from "@/app/(dashboard)/projects/[projectId]/[environmentId]/environment-detail";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function WorkspaceEnvironmentPage({
  params,
}: {
  params: Promise<{ projectId: string; environmentId: string }>;
}) {
  const { projectId, environmentId } = await params;
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  return (
    <EnvironmentDetail
      projectId={projectId}
      environmentId={environmentId}
      session={session}
    />
  );
}
