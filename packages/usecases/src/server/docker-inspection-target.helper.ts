import type { IUnitOfWork } from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { requiresRemoteServerPlacement } from "../platform/platform.types";
import type { DockerInspectionTarget } from "../ports/docker";

export async function resolveDockerInspectionTarget(
  uow: IUnitOfWork,
  input: {
    organizationId: string;
    serverId?: string;
  },
  options: {
    localName?: string;
    localServerIds?: readonly string[];
    allowLocalInCloud?: boolean;
  } = {},
): Promise<DockerInspectionTarget> {
  const localServerIds = options.localServerIds ?? ["local"];
  if (!input.serverId || localServerIds.includes(input.serverId)) {
    if (requiresRemoteServerPlacement() && !options.allowLocalInCloud) {
      throw new Error(
        "Local server target is not available in cloud mode. Please specify a remote server ID.",
      );
    }
    return { kind: "local", name: options.localName ?? "Local Docker" };
  }
  const server = await uow.serverRepository.findById(input.serverId);
  if (!server || server.organizationId !== input.organizationId) {
    throw new Error("Server is not part of the active organization.");
  }
  if (!server.sshKeyId) throw new Error("Server has no SSH key configured.");
  const key = await uow.sshKeyRepository.findById(server.sshKeyId);
  if (!key) throw new Error("Configured server SSH key was not found.");
  return {
    kind: "remote",
    name: server.name,
    host: server.ipAddress,
    port: server.port,
    username: server.username,
    hostKeyFingerprint: server.sshHostKeyFingerprint ?? undefined,
    privateKey: decryptSecret({
      ciphertext: key.privateKeyCiphertext,
      iv: key.privateKeyIv,
      authTag: key.privateKeyAuthTag,
      keyVersion: key.privateKeyVersion,
    }),
  };
}
