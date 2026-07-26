"use client";

import { redirect } from "next/navigation";
import { useEffect } from "react";

export default function AuditLogsRedirectPage() {
  useEffect(() => {
    redirect("/observation?tab=audits");
  }, []);

  return null;
}
