<img width="1220" height="685" alt="image" src="https://github.com/user-attachments/assets/4a2d20aa-9bc5-42d5-b3fc-998efa78ec3e" />

# Upstand

Upstand is a modern, container-first self-hostable control plane (PaaS) designed to orchestrate Docker Swarm nodes, deploy applications and databases, configure dynamic Caddy routing, and run remote server operations from a unified web interface.

It is built as a Bun/TypeScript monorepo leveraging Next.js, Hono, tRPC, Drizzle, PostgreSQL, Redis, Docker Swarm, and Better Auth.

---

## What Upstand Provides

### 📦 Application & Database Deployments

- **Flexible Builders**: Deploy using **Dockerfile** (with BuildKit secrets support), **Railpack**, **Nixpacks**, **Heroku Buildpacks**, **Paketo Buildpacks**, or **Static** folder serving (with SPA fallback).
- **Database Engines**: Natively provisions **PostgreSQL**, **MySQL**, **MariaDB**, **MongoDB**, **Redis**, and **libSQL (sqld)** (with dynamic HTTP/gRPC/admin port bindings and auto-derived auth tokens). Exposes custom diagnostic interfaces and safe container restarts or volume rebuilds.
- **Docker Compose & Stacks**: Write Compose files and run them using standard Compose or Swarm Stacks. Upstand includes a Compose-to-Stack syntax translator and volume/network name collision-safe randomization.
- **Durable Build Queues**: Deployment tasks run in independent server-node queues (`deployments-queue-<nodeId>`) with concurrency adjustments and build locking.

### 🌐 Routing, Certificates & Web Server

- **Atomic Caddy Reloads**: Dynamic Caddyfile compilation. Before reloads, configurations are dry-run validated inside the container. If it fails, the prior known-good config is preserved to avoid routing outages.
- **Automatic HTTPS**: Auto-managed TLS certificates through Let's Encrypt (production) or Caddy's Internal CA (private networks).
- **Advanced Routing Middleware**: Configure 301/302/307/308 redirects, custom HSTS/security headers, forward authentication proxy gates (with header copies), and basic authentication (supporting bcrypt hashes).

### 🖥️ Remote Server & Node Operations

- **Remote Server SSH Provisioning**: Register standalone Docker engines. Upstand connects over SSH (key-based), installs Docker Engine, initializes Swarm, provisions Caddy, and targets builds without joining the core control-plane Swarm.
- **Swarm Clustering**: Reveal and rotate manager/worker join tokens, drain nodes for maintenance, and remove cluster nodes safely without losing Raft quorum.
- **Owner SSH Terminal**: Interactive, WebSocket-brokered web terminal restricted exclusively to the Global Owner.
- **Log Reviewer**: Buffers log streams, filters by log levels (`Info`/`Error`/`Warning`/`Success`), allows search highlighting, and supports downloads.

### 💾 Backup, Recovery & Transfers

- **S3 Backups**: Back up databases and volume directories directly to S3-compatible endpoints using integrated **rclone** processes.
- **Control-Plane Backups**: Backup the PostgreSQL system database and Caddy volume configurations in a single archive. Restore operations require verified 2FA, administrative permissions, and validation strings.
- **Secure File Transfers**: Upload `.tar` archives (up to 50 MB) securely into named Docker volumes or active containers.

### 🔒 Enterprise Security & SSO

- **Owner-First Bootstrap**: The first account created on a new database is assigned Global Owner. Additional registrations are blocked.
- **Corporate Single Sign-On (SSO)**: Add OIDC and SAML 2.0 logins. Domain enforcement is secured using DNS TXT ownership challenges (`_upstand-sso.<domain>`).
- **SCIM 2.0 User Provisioning**: Standardized `/api/scim/v2.0/<organizationId>` endpoints for automated directory user syncs.
- **TOTP 2FA & API Keys**: Enforce multi-factor authentication on critical actions (terminal, database rebuilds, backups) and issue scoped API keys (`upk_...`) for external integrations.

### 🤖 UpGal AI Operations Assistant

- **ToolLoopAgent**: Bounded to 12-step execution loops. Allows natural language infrastructure inspection and modification.
- **Mutation Approvals**: Operations such as resource deployments, creations, and deletions require explicit user confirmation via dashboard card prompts.
- **Model Context Protocol (MCP)**: Exposes a JSON-RPC endpoint at `/api/mcp` for external agents, supporting granular API key permissions.

---

## System Architecture

```mermaid
flowchart TD
    Client([User Browser / API Client]) -->|HTTPS / tRPC| Web[apps/web\nNext.js Dashboard]
    Client -->|HTTPS / REST & WS| Server[apps/server\nHono API & WS Broker]

    subgraph ControlPlane [Upstand Control Plane]
        Web --> Server
        Server --> Auth[packages/auth\nBetter Auth]
        Server --> API[packages/api\ntRPC Router]
        Server --> UpGal[UpGal AI Engine\nToolLoopAgent]
        UpGal -->|Execute Tools| API
        API --> UseCases[packages/usecases\nApplication Workflows]
        UseCases --> Domain[packages/domain\nBusiness Logic & Ports]
        UseCases --> DB[(packages/db\nPostgreSQL)]
        UseCases --> Queue[(packages/redis\nRedis / BullMQ)]
    end

    subgraph Infrastructure [Target Nodes & Workloads]
        Queue --> Worker[Deployment Worker Queue]
        Worker -->|Docker Socket / Swarm API| DockerEngine[Docker Swarm Engine]
        Worker -->|SSH Key Tunnel| RemoteHost[Remote Docker Hosts]
        Server -->|Atomic Config & Reloads| Caddy[Caddy Reverse Proxy]
        Caddy -->|Auto HTTPS Routing| Workloads[Containerized Apps & DBs]
    end
```

---

## Repository Map

```text
apps/web/               Next.js dashboard console & UI components
apps/server/            Hono API, tRPC routes, terminal broker, and worker queues
apps/monitoring/        System metrics collector & daemon watcher
apps/fumadocs/          Documentation site (Fumadocs)
packages/domain/        Core business rules, entities, and repository ports
packages/usecases/      Use case workflows and operational logic
packages/infrastructure/ External provider adapters (databases, notifications)
packages/db/            Drizzle PostgreSQL schema and migrations
packages/repositories/  Drizzle repository implementations
packages/redis/         Redis connection and BullMQ queue orchestration
packages/platform/      Crypto modules and SSH operations
packages/auth/          Better Auth configuration and authentication adapters
packages/api/           tRPC router definitions and Hono bindings
packages/ui/            Shared design primitives and design tokens
packages/env/           Zod-validated environment configurations
packages/config/        Shared TypeScript, Biome, and Architecture boundary rules
install.sh              Production installer script
docker-compose.local.yml Local development database/queue services
docker-compose.prod.yml  Production Swarm stack configuration
```

---

## Local Development

### Prerequisites

- **Bun 1.3.14**
- **Docker Engine & Compose v2**

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/upstandplatform/upstand.git
   cd upstand
   ```
2. Run the idempotent local setup:
   ```bash
   bun setup
   ```
   This creates ignored local environment files for the API and web app, installs dependencies, starts PostgreSQL 18 and Redis 8.8, waits for readiness, and applies the checked-in migrations. Local database data is stored in the versioned `postgres_data_v18` volume.
3. Launch the development workspace:
   ```bash
   bun dev
   ```
   Open `http://localhost:3001` for the web console, `http://localhost:3000/api/docs/` for the API Swagger UI, and `http://localhost:4000` for Fumadocs. Run `bun setup` again after pulling dependency or schema changes.

The mode-specific launchers are safe to rerun and switch between:

```bash
bun dev:self-hosted
bun dev:cloud
```

Only an Upstand-owned development process is stopped when switching modes.
Self-hosted and cloud development use separate Compose projects, PostgreSQL
volumes, Redis volumes, and framework caches. They share the existing local
encrypted Swarm network so Docker Desktop does not have to attach standalone
Compose containers to multiple overlay networks. The previous mode's data is
preserved while its runtime is stopped.

To create a disposable local Ubuntu SSH target for real remote-server setup
tests, install Multipass with Hyper-V support and run:

```bash
bun run remote:up
bun run remote:status
bun run remote:down       # stop VMs without deleting them
bun run remote:reset      # explicit destructive VM deletion
```

The default `deploy` VM starts without Docker so the Upstand provisioning flow
can install Docker, initialize Swarm, configure Caddy, and deploy monitoring.
Optional role targets are available with `bun run remote:up -- --profile database,build`.
The command prints each VM's IP and the generated local SSH-key path for the
Remote Servers onboarding wizard.

For database schema changes, update the TypeScript schema and run `bun run db:generate`; Drizzle Kit generates the migration files. Never create migration files manually.

### Desktop shell

The Electron desktop shell packages the existing Upstand dashboard as a secure
native client. It connects to a self-hosted or cloud control-plane origin; it
does not duplicate the control plane or Docker engine on the workstation.

```bash
# Development (connect the dialog to http://localhost:3001 after bun dev)
bun run --cwd apps/desktop dev

# Produce the platform-native installer artifacts
bun run --cwd apps/desktop make
```

The shell keeps the configured origin in the operating-system app-data folder,
exposes only a small context-isolated IPC API, and sends external links to the
default browser. Remote origins must use HTTPS.

For major database image upgrades, read the [database upgrade runbook](apps/fumadocs/content/docs/operations/database-upgrades.mdx) before updating a production stack. PostgreSQL major versions require a logical dump/restore or `pg_upgrade`; do not reuse PostgreSQL 16 data files in the PostgreSQL 18 volume.

---

## Production Installation & Deployments

Upstand can be installed as a **Self-Hosted** instance or run as a multi-tenant **Cloud Service** (SaaS) depending on the configuration flags.

### 1. Self-Hosted Mode (Default)

In self-hosted mode, you can deploy applications, databases, and Docker Compose configurations directly onto the local Docker Swarm manager node running the Upstand dashboard.

To install Self-Hosted Upstand on a fresh Linux Swarm manager node:

The installer also supports a zero-configuration bootstrap. When image tags,
digests, and secrets are omitted, it generates random secrets in
`/etc/upstand/secrets/`, detects the host address, downloads the stack file for
the explicitly selected audited release tag, and pulls that release's images
from GHCR. It resolves the release manifest to immutable digests before
deploying:

```bash
export UPSTAND_VERSION="v0.1.8" # replace with the audited release tag
curl -fsSL "https://raw.githubusercontent.com/UpstandPlatform/upstand/${UPSTAND_VERSION}/install.sh" | sudo -E bash
```

To build from source instead, opt in explicitly with `UPSTAND_BUILD_FROM_SOURCE=true`.
Source builds use `https://proxy.golang.org|direct`, so a temporary or policy-based
HTTP error from the Go module proxy falls back to GitHub. On a server that must
use an internal Go mirror, override it explicitly before running the installer:

```bash
export GOPROXY='https://go-proxy.example.com|direct'
export UPSTAND_VERSION="v0.1.8" # replace with the audited release tag
curl -fsSL "https://raw.githubusercontent.com/UpstandPlatform/upstand/${UPSTAND_VERSION}/install.sh" | sudo -E bash
```

The `|` separator is intentional: Go only tries the next source for all proxy
errors when pipe fallback is used. The comma form falls back only for 404 and
410 responses.

Without URL variables, the dashboard, API, and docs start on the detected host
IP at ports `3001`, `3000`, and `4000`. Configure the domain and HTTPS from the
Web Server page first, then disable **Direct IP:port access** there when the
domain is ready.

```bash
export BETTER_AUTH_URL=https://api.example.com
export CORS_ORIGIN=https://app.example.com
export NEXT_PUBLIC_SERVER_URL=https://api.example.com

# Pin image digests
export UPSTAND_SERVER_IMAGE=ghcr.io/upstandplatform/upstand-server@sha256:<digest>
export UPSTAND_SCHEDULES_IMAGE=ghcr.io/upstandplatform/upstand-schedules@sha256:<digest>
export UPSTAND_MONITORING_IMAGE=ghcr.io/upstandplatform/upstand-monitoring@sha256:<digest>
export UPSTAND_WEB_IMAGE=ghcr.io/upstandplatform/upstand-web@sha256:<digest>
export UPSTAND_DOCS_IMAGE=ghcr.io/upstandplatform/upstand-fumadocs@sha256:<digest>

# Only for private registries: credentials are used for deployment and are not
# written to the Upstand environment file.
export UPSTAND_REGISTRY=ghcr.io
export UPSTAND_REGISTRY_USERNAME=<registry-user>
export UPSTAND_REGISTRY_PASSWORD=<registry-token>

export UPSTAND_VERSION="v0.1.8" # replace with the audited release tag
curl -fsSL "https://raw.githubusercontent.com/UpstandPlatform/upstand/${UPSTAND_VERSION}/install.sh" | sudo -E bash
```

### 2. Cloud Mode (Multi-Tenant SaaS)

In cloud mode, local server target deployments are blocked for security and resource isolation. Users are forced to add and select their own remote servers (connected via SSH) to run applications, databases, and registry configurations.

To deploy Upstand in cloud mode, enable the following flags in your environment configuration before starting the control-plane containers:

```bash
export BETTER_AUTH_URL=https://api.example.com
export CORS_ORIGIN=https://app.example.com
export NEXT_PUBLIC_SERVER_URL=https://api.example.com

# Pin all release images. Cloud mode is read from the server at runtime.
export UPSTAND_SERVER_IMAGE=ghcr.io/upstandplatform/upstand-server@sha256:<digest>
export UPSTAND_SCHEDULES_IMAGE=ghcr.io/upstandplatform/upstand-schedules@sha256:<digest>
export UPSTAND_WEB_IMAGE=ghcr.io/upstandplatform/upstand-web@sha256:<digest>
export UPSTAND_MONITORING_IMAGE=ghcr.io/upstandplatform/upstand-monitoring@sha256:<digest>
export UPSTAND_DOCS_IMAGE=ghcr.io/upstandplatform/upstand-fumadocs@sha256:<digest>

export UPSTAND_VERSION="v0.1.8" # replace with the audited release tag
curl -fsSL "https://raw.githubusercontent.com/UpstandPlatform/upstand/${UPSTAND_VERSION}/install.sh" | sudo -E bash -s -- --cloud
```

The `--cloud` flag sets the server cloud mode. The web console reads that mode from the API at runtime, so the same immutable web image is used for cloud and self-hosted installations. The installer validates all configured API, dashboard, and documentation origins from the deployment host before reporting success.

For detailed guides, refer to the local documentation site (`apps/fumadocs`) or navigate to `/docs/getting-started` once deployed.

### Contributors 🤝

<a href="https://github.com/UpstandPlatform/upstand/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=UpstandPlatform/upstand" alt="Contributors" />
</a>
