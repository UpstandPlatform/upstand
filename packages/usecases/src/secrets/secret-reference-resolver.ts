import {
  type IUnitOfWork,
  SecretProviderAssignmentSchema,
  type SecretProviderConfiguration,
} from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import type { ExternalSecretProviderPort } from "../ports/external-secrets";

/** Dokploy-compatible external secret reference syntax. */
const SECRET_PROVIDER_REFERENCE_PREFIX = "${{vault.";
const SECRET_PROVIDER_NAME_CHARACTERS = /^[A-Za-z0-9_-]$/;

type SecretProviderReferenceMatch = {
  end: number;
  providerName: string;
  reference: string;
  start: number;
};

function isProviderName(value: string): boolean {
  if (!value) return false;
  for (const character of value) {
    if (!SECRET_PROVIDER_NAME_CHARACTERS.test(character)) return false;
  }
  return true;
}

function findSecretProviderReferences(
  value: string,
): SecretProviderReferenceMatch[] {
  const matches: SecretProviderReferenceMatch[] = [];
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const start = value.indexOf(SECRET_PROVIDER_REFERENCE_PREFIX, searchFrom);
    if (start === -1) break;
    const providerStart = start + SECRET_PROVIDER_REFERENCE_PREFIX.length;
    const providerSeparator = value.indexOf(".", providerStart);
    if (providerSeparator === -1) break;
    const providerName = value.slice(providerStart, providerSeparator);
    const referenceStart = providerSeparator + 1;
    const endMarker = value.indexOf("}}", referenceStart);
    if (endMarker === -1) break;
    const reference = value.slice(referenceStart, endMarker);
    if (
      isProviderName(providerName) &&
      reference.length > 0 &&
      !reference.includes("}")
    ) {
      matches.push({
        end: endMarker + 2,
        providerName,
        reference,
        start,
      });
      searchFrom = endMarker + 2;
      continue;
    }
    searchFrom = start + SECRET_PROVIDER_REFERENCE_PREFIX.length;
  }
  return matches;
}

export function containsSecretProviderReference(value: string): boolean {
  return findSecretProviderReferences(value).length > 0;
}

export type SecretProviderResolutionScope = {
  organizationId: string;
  projectId: string;
  environmentId?: string;
};

type StoredProviderConfiguration = SecretProviderConfiguration & {
  __upstandAssignments?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decryptConfiguration(value: string): StoredProviderConfiguration {
  try {
    const payload = JSON.parse(value) as {
      ciphertext: string;
      iv: string;
      authTag: string;
      keyVersion: number;
    };
    const decoded = JSON.parse(decryptSecret(payload)) as unknown;
    if (!isRecord(decoded)) throw new Error("configuration is not an object");
    return decoded as StoredProviderConfiguration;
  } catch {
    throw new Error("Secret provider configuration could not be decrypted");
  }
}

function isProviderAssigned(
  assignments: unknown,
  scope: SecretProviderResolutionScope,
): boolean {
  // Providers created by the original Upstand UI had no assignment model.
  // Keep them working while making explicit Dokploy-style assignments fail
  // closed when the list is empty.
  if (assignments === undefined) return true;
  const parsed = SecretProviderAssignmentSchema.array().safeParse(assignments);
  if (!parsed.success)
    throw new Error("Secret provider assignments are invalid");
  return parsed.data.some(
    (assignment) =>
      assignment.projectId === scope.projectId &&
      (assignment.environmentIds.length === 0 ||
        !scope.environmentId ||
        assignment.environmentIds.includes(scope.environmentId)),
  );
}

function referenceKey(providerName: string, reference: string): string {
  return `${providerName}\u0000${reference}`;
}

async function resolveValues(
  values: string[],
  uow: IUnitOfWork,
  external: ExternalSecretProviderPort,
  scope: SecretProviderResolutionScope,
): Promise<string[]> {
  const matches = values.flatMap((value, valueIndex) =>
    findSecretProviderReferences(value).map((match) => ({
      valueIndex,
      providerName: match.providerName,
      reference: match.reference.trim(),
    })),
  );
  if (matches.length === 0) return values;
  const readReferences = external.readReferences;
  if (!readReferences) {
    throw new Error("External secret reference resolution is unavailable");
  }
  if (matches.some((match) => !match.reference)) {
    throw new Error(
      "External secret references must include a provider reference",
    );
  }

  const providers =
    await uow.secretProviderRepository.findEnabledConfigurationsByOrganizationId(
      scope.organizationId,
    );
  const refsByProvider = new Map<string, Set<string>>();
  for (const match of matches) {
    const references =
      refsByProvider.get(match.providerName) ?? new Set<string>();
    references.add(match.reference);
    refsByProvider.set(match.providerName, references);
  }

  const resolved = new Map<string, string>();
  await Promise.all(
    [...refsByProvider.entries()].map(async ([providerName, references]) => {
      const provider = providers.find(
        (candidate) => candidate.name === providerName,
      );
      if (!provider) {
        throw new Error(
          `Secret provider "${providerName}" not found. Configure it in Settings → Secret Providers.`,
        );
      }
      const stored = decryptConfiguration(provider.encryptedConfiguration);
      if (!isProviderAssigned(stored.__upstandAssignments, scope)) {
        throw new Error(
          `Secret provider "${providerName}" is not enabled for this project/environment.`,
        );
      }
      const configuration: SecretProviderConfiguration = { ...stored };
      delete (configuration as StoredProviderConfiguration)
        .__upstandAssignments;
      const fetched = await readReferences(provider.provider, configuration, [
        ...references,
      ]);
      for (const reference of references) {
        const fetchedValue = fetched[reference];
        if (fetchedValue === undefined) {
          throw new Error(
            `Secret "${reference}" not found in provider "${providerName}"`,
          );
        }
        resolved.set(referenceKey(providerName, reference), fetchedValue);
      }
    }),
  );

  return values.map((value) => {
    const references = findSecretProviderReferences(value);
    if (references.length === 0) return value;
    let resolvedValue = "";
    let cursor = 0;
    for (const match of references) {
      const reference = match.reference.trim();
      const fetched = resolved.get(referenceKey(match.providerName, reference));
      if (fetched === undefined) {
        throw new Error(
          `Secret "${reference}" was not resolved from provider "${match.providerName}"`,
        );
      }
      resolvedValue += value.slice(cursor, match.start);
      resolvedValue += fetched;
      cursor = match.end;
    }
    return resolvedValue + value.slice(cursor);
  });
}

export function resolveSecretProviderReferences(
  value: string | null | undefined,
  uow: IUnitOfWork,
  external: ExternalSecretProviderPort,
  scope: SecretProviderResolutionScope,
): Promise<string | null | undefined> {
  if (value === null || value === undefined) return Promise.resolve(value);
  return resolveValues([value], uow, external, scope).then(
    ([resolved]) => resolved,
  );
}

export async function resolveSecretProviderReferencesInValues(
  values: Record<string, string>,
  uow: IUnitOfWork,
  external: ExternalSecretProviderPort,
  scope: SecretProviderResolutionScope,
): Promise<Record<string, string>> {
  const keys = Object.keys(values);
  const resolved = await resolveValues(
    keys.map((key) => values[key] as string),
    uow,
    external,
    scope,
  );
  return Object.fromEntries(
    keys.map((key, index) => [key, resolved[index] as string]),
  );
}
