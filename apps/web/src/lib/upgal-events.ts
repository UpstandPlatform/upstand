export interface UpGalDraftEventDetail {
  filename?: string;
  content?: string;
  mediaType?: string;
  prompt?: string;
}

export function askUpGalWithLogs(logsText: string, defaultPrompt?: string) {
  if (typeof window === "undefined") return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `container-logs-${timestamp}.txt`;

  const detail: UpGalDraftEventDetail = {
    filename,
    content: logsText,
    mediaType: "text/plain",
    prompt:
      defaultPrompt ||
      "Please analyze these container logs and explain any errors, warnings, or anomalies:",
  };

  window.dispatchEvent(new CustomEvent("upgal:draft", { detail }));
}
