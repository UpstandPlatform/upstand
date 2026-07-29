import { redirect } from "next/navigation";
import ResourceDetail from "@/features/resources";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    projectId: string;
    environmentId: string;
    resourceId: string;
  }>;
}

export default async function ResourcePage({ params }: PageProps) {
  const { projectId, environmentId, resourceId } = await params;
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <ResourceDetail
      projectId={projectId}
      environmentId={environmentId}
      resourceId={resourceId}
      session={session}
    />
  );
}
