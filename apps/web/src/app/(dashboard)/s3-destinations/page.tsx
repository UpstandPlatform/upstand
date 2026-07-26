import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import S3Destinations from "./s3-destinations";

export const dynamic = "force-dynamic";

export default async function S3DestinationsPage() {
  let session = null;
  try {
    session = await getServerSession();
  } catch {}

  if (!session?.user) {
    redirect("/login");
  }

  return <S3Destinations session={session} />;
}
