import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import SSHKeys from "./ssh-keys";

export const dynamic = "force-dynamic";

export default async function SSHKeysPage() {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  return <SSHKeys session={session} />;
}
