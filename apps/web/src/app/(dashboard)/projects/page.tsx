import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import Projects from "./projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  return <Projects session={session} />;
}
