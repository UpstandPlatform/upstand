import { redirect } from "next/navigation";
import ProjectDetail from "@/app/(dashboard)/projects/[projectId]/project-detail";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function WorkspaceProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  return <ProjectDetail projectId={projectId} session={session} />;
}
