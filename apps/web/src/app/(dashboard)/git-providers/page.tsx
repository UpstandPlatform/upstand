import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import GitProviders from "./git-providers";

export const dynamic = "force-dynamic";

export default async function GitProvidersPage() {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  return <GitProviders session={session} />;
}
