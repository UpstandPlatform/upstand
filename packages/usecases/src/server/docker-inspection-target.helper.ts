import type { IUnitOfWork } from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
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
  } = {},
): Promise<DockerInspectionTarget> {
  const localServerIds = options.localServerIds ?? ["local"];
  if (!input.serverId || localServerIds.includes(input.serverId)) {
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
    privateKey: decryptSecret({
      ciphertext: key.privateKeyCiphertext,
      iv: key.privateKeyIv,
      authTag: key.privateKeyAuthTag,
      keyVersion: key.privateKeyVersion,
    }),
  };
}
