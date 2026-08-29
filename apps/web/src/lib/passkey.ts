export const PASSKEY_NAME_MAX_LENGTH = 120;

export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.get === "function"
  );
}

export function normalizePasskeyName(value: string): string {
  return value.trim().slice(0, PASSKEY_NAME_MAX_LENGTH);
}
