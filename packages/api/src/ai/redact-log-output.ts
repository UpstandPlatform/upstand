const SENSITIVE_ASSIGNMENT =
  /((?:password|passwd|token|secret|api[_-]?key|authorization|private[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*)([^\s,;]+)/gi;

const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC_CREDENTIAL = /\bBasic\s+[A-Za-z0-9+/=]+/gi;
const URL_CREDENTIALS = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

export function redactLogOutput(value: string): string {
  return value
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(BASIC_CREDENTIAL, "Basic [REDACTED]")
    .replace(URL_CREDENTIALS, "$1[REDACTED]@")
    .replace(SENSITIVE_ASSIGNMENT, "$1[REDACTED]");
}
