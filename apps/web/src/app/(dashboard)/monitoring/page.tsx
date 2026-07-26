"use client";

import { redirect } from "next/navigation";
import { useEffect } from "react";

export default function MonitoringRedirectPage() {
  useEffect(() => {
    redirect("/observation?tab=monitoring");
  }, []);

  return null;
}
