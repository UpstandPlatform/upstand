# @upstand/cli

The official Upstand command-line interface. It uses OpenTUI for interactive
terminal rendering and supports Bun as its runtime.

```bash
bun add -g @upstand/cli
npm install -g @upstand/cli
bunx @upstand/cli --help
upstand login
upstand project list --organization org_...
upstand link --organization org_... --project project_... --environment env_...
upstand deploy <resource-id>
```

Use `UPSTAND_URL` to target a self-hosted control plane and `UPSTAND_TOKEN` for
CI. Tokens are never written to project files.

Interactive `upstand login` opens the Upstand browser sign-in flow and waits
for organization approval. Use `upstand login --token upk_...` in CI or when a
key is already available.
