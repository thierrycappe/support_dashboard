# Scenarios — executable specifications

This folder is the **source of truth** for end-to-end user journeys. Each scenario is a markdown file at `scenarios/<feature-area>/SCN-NNN-kebab-title.md`.

## Rules

1. **Numbering is project-wide and sequential.** `SCN-001`, `SCN-002`, … regardless of feature area. Use the next available number.
2. **Folder grouping is by feature area.** Examples: `scenarios/auth/`, `scenarios/customer-form/`, `scenarios/admin-dashboard/`.
3. **Every scenario has a Playwright spec** at `e2e/scenarios/<area>/SCN-NNN.spec.ts`.
4. **The spec header carries a hash:** `// scaffold:scenario:SCN-NNN:<8-hex-hash>` matching the scenario's body hash.
5. **When a feature changes, update the scenario first**, then regenerate the spec from it.

## Drift detection

Run `npx tsx scripts/check-scenario-drift.ts` (or wire it into your test pipeline) to verify that every scenario and its spec are in sync. CI fails if drift is detected.

## How to author a new scenario

1. Pick the next `SCN-NNN`.
2. Pick or create a feature-area folder.
3. Copy `_TEMPLATE.md` into `scenarios/<area>/SCN-NNN-<title>.md` and fill it in.
4. Compute the body hash and put it in the frontmatter `spec_hash:` field. (Or run the drift check; it will tell you what hash to use.)
5. Generate the matching Playwright spec at `e2e/scenarios/<area>/SCN-NNN.spec.ts`. The first comment line must be `// scaffold:scenario:SCN-NNN:<hash>`.
6. Run `npx tsx scripts/check-scenario-drift.ts` to confirm sync.
