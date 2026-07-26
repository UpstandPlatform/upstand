import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  IUnitOfWork,
  ScimMembershipFilter,
  ScimMembershipPatch,
  ScimMembershipRecord,
  ScimProviderRecord,
} from "@upstand/domain";
import { ConflictError } from "@upstand/domain";
import type { ManagedUserProvisioner } from "../ports/managed-user-provisioner";

export class ScimConflictError extends Error {
  constructor(message = "SCIM resource already exists") {
    super(message);
    this.name = "ScimConflictError";
  }
}

export class ScimNotFoundError extends Error {
  constructor(message = "SCIM resource was not found") {
    super(message);
    this.name = "ScimNotFoundError";
  }
}

export class ScimProvisioningError extends Error {
  constructor(message = "Unable to provision SCIM resource") {
    super(message);
    this.name = "ScimProvisioningError";
  }
}

export type CreateScimUserInput = {
  organizationId: string;
  email: string;
  displayName: string | null;
  active: boolean;
  externalId: string | null;
};

function createScimToken(): { token: string; hash: string; prefix: string } {
  const token = `upscim_${randomBytes(32).toString("base64url")}`;
  return {
    token,
    hash: createHash("sha256").update(token).digest("hex"),
    prefix: token.slice(0, 14),
  };
}

export class ScimUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly userProvisioner: ManagedUserProvisioner,
  ) {}

  listProviders(organizationId: string): Promise<ScimProviderRecord[]> {
    return this.uow.scimRepository.listProviders(organizationId);
  }

  async createProvider(
    organizationId: string,
    providerId: string,
  ): Promise<ScimProviderRecord & { token: string }> {
    const token = createScimToken();
    const provider = await this.uow.scimRepository.createProvider({
      id: randomUUID(),
      organizationId,
      providerId,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (!provider)
      throw new ScimProvisioningError("SCIM provider was not created");
    return { ...provider, token: token.token };
  }

  async rotateProvider(
    organizationId: string,
    id: string,
  ): Promise<ScimProviderRecord & { token: string }> {
    const token = createScimToken();
    const provider = await this.uow.scimRepository.rotateProviderToken(
      organizationId,
      id,
      token.hash,
      token.prefix,
      new Date(),
    );
    if (!provider) throw new ScimNotFoundError("SCIM provider was not found");
    return { ...provider, token: token.token };
  }

  async deleteProvider(organizationId: string, id: string): Promise<void> {
    const deleted = await this.uow.scimRepository.deleteProvider(
      organizationId,
      id,
    );
    if (!deleted) throw new ScimNotFoundError("SCIM provider was not found");
  }

  async authorize(organizationId: string, authorization: string) {
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";
    if (!token || token.length > 256) return null;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return this.uow.scimRepository.findProvider(organizationId, tokenHash);
  }

  findMembership(organizationId: string, userId: string) {
    return this.uow.scimRepository.findMembership(organizationId, userId);
  }

  async listMemberships(
    organizationId: string,
    options: {
      filter?: ScimMembershipFilter;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ rows: ScimMembershipRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.uow.scimRepository.listMemberships(organizationId, options),
      this.uow.scimRepository.countMemberships(organizationId, options.filter),
    ]);
    return { rows, total };
  }

  async createUser(input: CreateScimUserInput): Promise<ScimMembershipRecord> {
    const existingUser = await this.uow.scimRepository.findUserByEmail(
      input.email,
    );
    if (existingUser) {
      const existingMembership = await this.findMembership(
        input.organizationId,
        existingUser.id,
      );
      if (existingMembership) throw new ScimConflictError();
    }

    let userId: string;
    let userName: string;
    let createdUser = false;
    if (existingUser) {
      userId = existingUser.id;
      userName = existingUser.name;
    } else {
      const created = await this.userProvisioner.createManagedUser({
        email: input.email,
        name: input.email,
        password: randomBytes(32).toString("base64url"),
      });
      userId = created.id;
      userName = created.name;
      createdUser = true;
    }

    try {
      const membership = await this.uow.scimRepository.provisionMembership({
        organizationId: input.organizationId,
        userId,
        scimActive: input.active,
        scimExternalId: input.externalId,
        scimDisplayName: (input.displayName || userName).slice(0, 120),
        removePersonalOrganizations: createdUser,
      });
      if (!membership) throw new ScimProvisioningError();
      return membership;
    } catch (error) {
      if (createdUser) {
        await this.uow.scimRepository.deleteUser(userId).catch(() => false);
      }
      if (error instanceof ConflictError) {
        throw new ScimConflictError();
      }
      if (error instanceof ScimProvisioningError) throw error;
      throw new ScimProvisioningError();
    }
  }

  async updateUser(
    organizationId: string,
    userId: string,
    patch: ScimMembershipPatch,
  ): Promise<ScimMembershipRecord> {
    const updated = await this.uow.scimRepository.updateMembership(
      organizationId,
      userId,
      patch,
    );
    if (!updated) throw new ScimNotFoundError("SCIM user not found");
    const membership = await this.findMembership(organizationId, userId);
    if (!membership) throw new ScimNotFoundError("SCIM user not found");
    return membership;
  }

  async deleteUser(organizationId: string, userId: string): Promise<void> {
    const deleted = await this.uow.scimRepository.deleteMembershipAndSessions(
      organizationId,
      userId,
    );
    if (!deleted) throw new ScimNotFoundError("SCIM user not found");
  }
}
