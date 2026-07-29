import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import WebServerDashboard from "./web-server";

export const dynamic = "force-dynamic";

export default async function WebServerPage() {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  return <WebServerDashboard session={session} />;
}
