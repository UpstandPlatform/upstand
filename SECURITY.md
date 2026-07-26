# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the repository's private security advisory feature or contact the project maintainers through the private contact channel configured for this repository. Include:

- affected version or commit;
- exact reproduction steps or a minimal proof of concept;
- impact and prerequisites;
- logs with secrets, tokens, private keys, cookies, and personal data removed;
- a suggested mitigation, if known.

We will acknowledge a report as soon as practical, validate the impact, coordinate a fix and disclosure timeline, and credit the reporter when they want credit. Do not test against systems you do not own or have explicit permission to assess.

## Security expectations for operators

- Keep `/etc/upstand/.env`, SSH private keys, database backups, and Better Auth secrets private.
- Use HTTPS origins in production and restrict SSH and Docker Swarm ports with network policy.
- Pin production images by digest and review release notes before upgrading.
- Rotate credentials after accidental exposure; do not merely delete them from logs.
- Grant organization and terminal access only to trusted owners.
- Keep Docker, Bun, PostgreSQL, Redis, and the host OS patched.
