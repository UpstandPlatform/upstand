# @upstand/auth (`packages/auth`)

The `@upstand/auth` package manages multi-tenant authentication, user sessions, organization memberships, Single Sign-On (SSO), and SCIM directory provisioning for Upstand. Built on **Better Auth**.

## Features

- **Better Auth Integration**: Email/password authentication, TOTP two-factor authentication (2FA), session cookie management.
- **Organization RBAC**: Multi-tenant organization scoping, role-based access control (Owner, Admin, Member, Custom Roles), team invitations.
- **API Keys Plugin**: Managed API keys (`upk_...`) via `@better-auth/api-key` with granular capability permissions.
- **Enterprise SSO (SAML & OIDC)**: Single Sign-On integration with DNS TXT domain ownership verification.
- **SCIM 2.0 Directory Sync**: Automated user provisioning, deprovisioning, and group mapping endpoints (`/api/scim/v2.0/*`).

## Usage

```typescript
import { auth } from "@upstand/auth";
import { getSession } from "@upstand/auth/client";
```
