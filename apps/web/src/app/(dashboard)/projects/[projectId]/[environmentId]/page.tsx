import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import EnvironmentDetail from "./environment-detail";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    projectId: string;
    environmentId: string;
  }>;
}

export default async function EnvironmentPage({ params }: PageProps) {
  const { projectId, environmentId } = await params;
  let session = null;
  try {
    session = await getServerSession();
  } catch {}

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <EnvironmentDetail
      projectId={projectId}
      environmentId={environmentId}
      session={session}
    />
  );
}
