import { z } from "zod";
import {
  API_KEY_CAPABILITY_ACTIONS,
  type Capability,
  CUSTOM_ROLE_CAPABILITY_ACTIONS,
} from "./authorization";

/** Permission lists exposed to clients and validated by the server. */
export const PERMISSION_SCOPE_ACTIONS = {
  apiKey: API_KEY_CAPABILITY_ACTIONS,
  member: CUSTOM_ROLE_CAPABILITY_ACTIONS,
} as const satisfies Record<string, readonly Capability[]>;

export const API_KEY_SCOPE_ACTIONS = PERMISSION_SCOPE_ACTIONS.apiKey;
export const MEMBER_SCOPE_ACTIONS = PERMISSION_SCOPE_ACTIONS.member;

const memberScopeValues = MEMBER_SCOPE_ACTIONS as [Capability, ...Capability[]];

/** Canonical input contract for member and custom-role permissions. */
export const MemberPermissionsSchema = z
  .array(z.enum(memberScopeValues))
  .max(100);

export type MemberPermission = z.infer<typeof MemberPermissionsSchema>[number];
