import { redirect } from "next/navigation";
import Projects from "@/app/(dashboard)/projects/projects";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function WorkspaceProjectsPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  return <Projects session={session} />;
}
