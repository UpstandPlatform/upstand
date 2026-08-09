const MAX_DEPLOYMENT_LOG_BYTES = 2 * 1024 * 1024;
const TRUNCATION_MARKER = "[Earlier deployment logs truncated]\n";
const SENSITIVE_ASSIGNMENT =
  /\b(password|passwd|secret|token|api[_-]?key|private[_-]?key|database_url)\b\s*[:=]\s*([^\s,;]+)/gi;
const AUTHORIZATION = /\b(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s]+/gi;
const URL_CREDENTIALS = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const PRIVATE_KEY =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function redactDeploymentLog(input: string): string {
  return input
    .replace(PRIVATE_KEY, "[REDACTED PRIVATE KEY]")
    .replace(URL_CREDENTIALS, "$1[REDACTED]@")
    .replace(AUTHORIZATION, "$1[REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT, "$1=[REDACTED]");
}

export function appendBoundedDeploymentLog(
  current: string,
  chunk: string,
): string {
  const combined = current + redactDeploymentLog(chunk);
  if (Buffer.byteLength(combined, "utf8") <= MAX_DEPLOYMENT_LOG_BYTES) {
    return combined;
  }
  const budget =
    MAX_DEPLOYMENT_LOG_BYTES - Buffer.byteLength(TRUNCATION_MARKER);
  let tail = combined.slice(-budget);
  while (Buffer.byteLength(tail, "utf8") > budget) tail = tail.slice(1);
  return TRUNCATION_MARKER + tail;
}
