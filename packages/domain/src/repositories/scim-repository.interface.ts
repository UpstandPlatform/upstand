export type ScimUserRecord = {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ScimProviderRecord = {
  id: string;
  organizationId: string;
  providerId: string;
  tokenPrefix: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateScimProviderInput = {
  id: string;
  organizationId: string;
  providerId: string;
  tokenHash: string;
  tokenPrefix: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ScimMembershipRecord = {
  member: {
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    permissions: string | null;
    createdAt: Date;
    scimActive: boolean | null;
    scimExternalId: string | null;
    scimDisplayName: string | null;
  };
  user: ScimUserRecord;
};

export type ScimMembershipFilter =
  | { attribute: "userName"; value: string }
  | { attribute: "externalId"; value: string }
  | { attribute: "active"; value: boolean };

export type ScimMembershipPatch = {
  scimActive?: boolean;
  scimExternalId?: string | null;
  scimDisplayName?: string | null;
};

export type ProvisionScimMembershipInput = {
  organizationId: string;
  userId: string;
  scimActive: boolean;
  scimExternalId: string | null;
  scimDisplayName: string;
  removePersonalOrganizations: boolean;
};

export interface IScimRepository {
  listProviders(organizationId: string): Promise<ScimProviderRecord[]>;
  createProvider(
    input: CreateScimProviderInput,
  ): Promise<ScimProviderRecord | null>;
  rotateProviderToken(
    organizationId: string,
    id: string,
    tokenHash: string,
    tokenPrefix: string,
    updatedAt: Date,
  ): Promise<ScimProviderRecord | null>;
  deleteProvider(organizationId: string, id: string): Promise<boolean>;
  findProvider(
    organizationId: string,
    tokenHash: string,
  ): Promise<{ id: string } | null>;
  findUserByEmail(email: string): Promise<ScimUserRecord | null>;
  findMembership(
    organizationId: string,
    userId: string,
  ): Promise<ScimMembershipRecord | null>;
  listMemberships(
    organizationId: string,
    options?: {
      filter?: ScimMembershipFilter;
      limit?: number;
      offset?: number;
    },
  ): Promise<ScimMembershipRecord[]>;
  countMemberships(
    organizationId: string,
    filter?: ScimMembershipFilter,
  ): Promise<number>;
  provisionMembership(
    input: ProvisionScimMembershipInput,
  ): Promise<ScimMembershipRecord | null>;
  updateMembership(
    organizationId: string,
    userId: string,
    patch: ScimMembershipPatch,
  ): Promise<boolean>;
  deleteMembershipAndSessions(
    organizationId: string,
    userId: string,
  ): Promise<boolean>;
  deleteUser(userId: string): Promise<boolean>;
}
