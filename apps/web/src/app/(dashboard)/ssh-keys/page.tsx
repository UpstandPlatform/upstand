import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import SSHKeys from "./ssh-keys";

export const dynamic = "force-dynamic";

export default async function SSHKeysPage() {
  let session = null;
  try {
    session = await getServerSession();
  } catch {}

  if (!session?.user) {
    redirect("/login");
  }

  return <SSHKeys session={session} />;
}
