import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import ProjectDetail from "./project-detail";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  let session = null;
  try {
    session = await getServerSession();
  } catch {}

  if (!session?.user) {
    redirect("/login");
  }

  return <ProjectDetail projectId={projectId} session={session} />;
}
