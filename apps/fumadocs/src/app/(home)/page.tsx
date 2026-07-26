import {
  ArrowRightIcon,
  BotIcon,
  CpuIcon,
  DatabaseIcon,
  NetworkIcon,
  ServerIcon,
  TerminalIcon,
} from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-fd-background text-fd-foreground">
      {/* Background decoration */}
      <div className="absolute top-[-10%] left-[50%] -z-10 h-[600px] w-[1000px] -translate-x-[50%] rounded-full bg-gradient-to-tr from-indigo-500/20 via-violet-500/10 to-transparent blur-3xl" />

      {/* Hero Section */}
      <section className="mx-auto flex max-w-5xl flex-col items-center px-6 pt-20 pb-16 text-center lg:pt-32">
        <div className="inline-flex items-center gap-2 rounded-full border bg-fd-secondary/50 px-3 py-1 font-medium text-fd-primary text-sm backdrop-blur-md">
          <span className="flex size-2 animate-pulse rounded-full bg-indigo-500" />
          Self-Hostable PaaS Control Plane
        </div>

        <h1 className="mt-8 bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text font-extrabold text-5xl text-transparent tracking-tight sm:text-7xl dark:from-indigo-400 dark:via-violet-400 dark:to-indigo-300">
          Upstand
        </h1>

        <p className="mt-6 max-w-2xl text-fd-muted-foreground text-lg sm:text-xl">
          Deploy applications, compose stacks, and databases to Docker Swarm
          with a unified, secure control plane and AI-driven operations
          assistant.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/docs"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-fd-primary px-6 py-3 font-semibold text-fd-primary-foreground shadow-indigo-500/10 shadow-lg transition-transform duration-200 hover:scale-[1.02] hover:bg-fd-primary/95"
          >
            Explore Docs
            <ArrowRightIcon className="size-4" />
          </Link>
          <a
            href="https://github.com/UpstandPlatform/upstand"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border bg-fd-secondary px-6 py-3 font-semibold text-fd-secondary-foreground transition-transform duration-200 hover:scale-[1.02] hover:bg-fd-accent"
          >
            GitHub Repository
          </a>
        </div>
      </section>

      {/* Features Grid */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="text-center font-bold text-3xl tracking-tight sm:text-4xl">
          Everything you need to orchestrate workloads
        </h2>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {/* Card 1 */}
          <div className="group rounded-2xl border bg-fd-secondary/35 p-6 backdrop-blur-sm transition-all duration-200 hover:border-indigo-500/40 hover:bg-fd-secondary/50">
            <div className="inline-flex rounded-xl bg-indigo-500/10 p-3 text-indigo-500">
              <CpuIcon className="size-6" />
            </div>
            <h3 className="mt-4 font-bold text-xl">App Deployments</h3>
            <p className="mt-2 text-fd-muted-foreground text-sm">
              Build from Git, Nixpacks, Railpacks, or Dockerfile. Automated
              queue serialization and concurrency management.
            </p>
          </div>

          {/* Card 2 */}
          <div className="group rounded-2xl border bg-fd-secondary/35 p-6 backdrop-blur-sm transition-all duration-200 hover:border-indigo-500/40 hover:bg-fd-secondary/50">
            <div className="inline-flex rounded-xl bg-violet-500/10 p-3 text-violet-500">
              <DatabaseIcon className="size-6" />
            </div>
            <h3 className="mt-4 font-bold text-xl">Databases</h3>
            <p className="mt-2 text-fd-muted-foreground text-sm">
              Deploy Postgres, MySQL, MongoDB, Redis, and libSQL with persistent
              named volumes and encrypted credentials.
            </p>
          </div>

          {/* Card 3 */}
          <div className="group rounded-2xl border bg-fd-secondary/35 p-6 backdrop-blur-sm transition-all duration-200 hover:border-indigo-500/40 hover:bg-fd-secondary/50">
            <div className="inline-flex rounded-xl bg-indigo-500/10 p-3 text-indigo-500">
              <NetworkIcon className="size-6" />
            </div>
            <h3 className="mt-4 font-bold text-xl">Domains & Caddy</h3>
            <p className="mt-2 text-fd-muted-foreground text-sm">
              Zero-downtime reloads, automatic TLS with Let's Encrypt, security
              headers, redirects, and basic/forward authentication.
            </p>
          </div>

          {/* Card 4 */}
          <div className="group rounded-2xl border bg-fd-secondary/35 p-6 backdrop-blur-sm transition-all duration-200 hover:border-indigo-500/40 hover:bg-fd-secondary/50">
            <div className="inline-flex rounded-xl bg-violet-500/10 p-3 text-violet-500">
              <ServerIcon className="size-6" />
            </div>
            <h3 className="mt-4 font-bold text-xl">Remote Servers</h3>
            <p className="mt-2 text-fd-muted-foreground text-sm">
              Provision external Docker hosts over SSH. Manage Swarm managers,
              workers, drain states, and token rotations.
            </p>
          </div>

          {/* Card 5 */}
          <div className="group rounded-2xl border bg-fd-secondary/35 p-6 backdrop-blur-sm transition-all duration-200 hover:border-indigo-500/40 hover:bg-fd-secondary/50">
            <div className="inline-flex rounded-xl bg-indigo-500/10 p-3 text-indigo-500">
              <TerminalIcon className="size-6" />
            </div>
            <h3 className="mt-4 font-bold text-xl">Owner Terminal & Logs</h3>
            <p className="mt-2 text-fd-muted-foreground text-sm">
              Owner-only Web SSH terminals, custom log reviewer (buffers,
              download, levels), and CodeMirror editor surfaces.
            </p>
          </div>

          {/* Card 6 */}
          <div className="group rounded-2xl border bg-fd-secondary/35 p-6 backdrop-blur-sm transition-all duration-200 hover:border-indigo-500/40 hover:bg-fd-secondary/50">
            <div className="inline-flex rounded-xl bg-violet-500/10 p-3 text-violet-500">
              <BotIcon className="size-6" />
            </div>
            <h3 className="mt-4 font-bold text-xl">UpGal AI Assistant</h3>
            <p className="mt-2 text-fd-muted-foreground text-sm">
              AI operator running ToolLoopAgent, scoped organization security,
              explicit user approval UI, and MCP access.
            </p>
          </div>
        </div>
      </section>

      {/* Tech Stack Banner */}
      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h3 className="font-semibold text-fd-muted-foreground text-sm uppercase tracking-wider">
          Built with Modern Technologies
        </h3>
        <div className="mt-6 flex flex-wrap justify-center gap-x-8 gap-y-4 font-medium text-fd-muted-foreground text-lg">
          <span>Next.js 16</span>
          <span>•</span>
          <span>Hono</span>
          <span>•</span>
          <span>tRPC</span>
          <span>•</span>
          <span>Drizzle</span>
          <span>•</span>
          <span>PostgreSQL</span>
          <span>•</span>
          <span>Redis</span>
          <span>•</span>
          <span>Better Auth</span>
        </div>
      </section>
    </main>
  );
}
