# @upstand/usecases (`packages/usecases`)

The `@upstand/usecases` package contains application use case orchestrators and business logic flows for the Upstand platform.

## Key Usecases & Tokens

- `CreateResourceUseCase` / `DeployApplicationUseCase`: Application compilation, BuildKit execution, Swarm service rolling update, and Caddy ingress reload.
- `BackupDatabaseUseCase`: Streaming database dumps, AES-256 GCM vault encryption, S3 upload, and retention pruning.
- `SetupServerUseCase`: Server SSH connectivity verification, Docker installation, Swarm cluster initialization, and `upstand-network` overlay network creation.
- `ResetTwoFactorUseCaseToken` (`ResetTwoFactorUseCase`): Emergency 2FA TOTP state reset for administrators via administrative CLI (`cli.mjs`).
- `RotateSecretsUseCase`: External secret provider sync and versioned secret snapshot rotation.

## Usage

```typescript
import { DeployApplicationUseCaseToken, ResetTwoFactorUseCaseToken } from "@upstand/usecases/tokens";
```
