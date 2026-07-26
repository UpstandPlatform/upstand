# Changesets

Add one Markdown file per user-facing change. The front matter declares the
release level for the affected application or package, and the body becomes
part of the generated changelog.

Example:

```md
---
"web": minor
"server": patch
---

Describe the user-visible change and any upgrade or migration notes.
```

Use `bun changeset` to create a changeset interactively. Changeset files are
consumed by the automated release PR; do not edit generated version or
changelog files by hand.
