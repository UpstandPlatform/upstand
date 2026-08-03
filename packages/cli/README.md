# @upstand/cli

The official Upstand command-line interface. It uses OpenTUI for interactive
terminal rendering and supports Bun as its runtime.

```bash
bunx @upstand/cli --help
upstand login --token upk_...
upstand project list --organization org_...
upstand link --organization org_... --project project_... --environment env_...
upstand deploy <resource-id>
```

Use `UPSTAND_URL` to target a self-hosted control plane and `UPSTAND_TOKEN` for
CI. Tokens are never written to project files.
