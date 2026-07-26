import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import GitProviders from "./git-providers";

export const dynamic = "force-dynamic";

export default async function GitProvidersPage() {
  let session = null;
  try {
    session = await getServerSession();
  } catch {}

  if (!session?.user) {
    redirect("/login");
  }

  return <GitProviders session={session} />;
}
