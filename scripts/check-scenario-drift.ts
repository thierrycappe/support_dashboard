#!/usr/bin/env tsx
/**
 * check-scenario-drift.ts
 *
 * Walks scenarios/<area>/SCN-NNN-*.md files and verifies each one's body hash
 * matches the hash recorded in the linked Playwright spec's header comment.
 *
 * Run as part of the test pipeline. Exits non-zero if any drift is detected.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
const HEADER_MARKER_RE = /\/\/\s*scaffold:scenario:([A-Z]+-\d+):([a-f0-9]+)/

export interface DriftResult {
  checked: number
  errors: string[]
}

interface ScenarioMeta {
  id: string
  linked_spec?: string
  spec_hash?: string
}

export function computeScenarioBodyHash(fileContents: string): string {
  // Strip frontmatter, hash the rest
  const m = fileContents.match(FRONTMATTER_RE)
  const body = m ? m[2] : fileContents
  return createHash('sha256').update(body).digest('hex').slice(0, 8)
}

function parseFrontmatter(fileContents: string): ScenarioMeta | null {
  const m = fileContents.match(FRONTMATTER_RE)
  if (!m) return null
  const out: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    out[k] = v
  }
  if (!out.id) return null
  return { id: out.id, linked_spec: out.linked_spec, spec_hash: out.spec_hash }
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
    } else if (entry.endsWith('.md') && entry.startsWith('SCN-')) {
      out.push(full)
    }
  }
  return out
}

export function checkScenarioDrift(repoRoot: string): DriftResult {
  const scenariosDir = join(repoRoot, 'scenarios')
  const scenarioFiles = walk(scenariosDir)

  const errors: string[] = []

  for (const scnPath of scenarioFiles) {
    const contents = readFileSync(scnPath, 'utf8')
    const meta = parseFrontmatter(contents)
    if (!meta) {
      errors.push(`${relative(repoRoot, scnPath)}: missing or unparseable frontmatter`)
      continue
    }

    const bodyHash = computeScenarioBodyHash(contents)

    // 1. Spec file must exist
    if (!meta.linked_spec) {
      errors.push(`${meta.id}: missing linked_spec in frontmatter`)
      continue
    }
    const specPath = join(repoRoot, meta.linked_spec)
    if (!existsSync(specPath)) {
      errors.push(`${meta.id}: linked spec file missing at ${meta.linked_spec}`)
      continue
    }

    // 2. Frontmatter spec_hash must match body hash
    if (meta.spec_hash && meta.spec_hash !== bodyHash) {
      errors.push(
        `${meta.id}: scenario body changed but frontmatter spec_hash wasn't updated. ` +
        `Expected ${bodyHash}, frontmatter says ${meta.spec_hash}. Regenerate the spec ` +
        `or update the frontmatter (drift detected).`
      )
      continue
    }

    // 3. Spec header marker must match body hash
    const specContents = readFileSync(specPath, 'utf8')
    const headerLine = specContents.split('\n').find((l) => HEADER_MARKER_RE.test(l))
    if (!headerLine) {
      errors.push(
        `${meta.id}: spec file exists but has no scaffold:scenario header marker. ` +
        `Add a comment like "// scaffold:scenario:${meta.id}:${bodyHash}" at the top.`
      )
      continue
    }
    const m = headerLine.match(HEADER_MARKER_RE)!
    const headerHash = m[2]
    if (headerHash !== bodyHash) {
      errors.push(
        `${meta.id}: drift between scenario and spec. Scenario body hash is ${bodyHash}, ` +
        `spec header says ${headerHash}. Regenerate the spec from the scenario.`
      )
    }
  }

  return { checked: scenarioFiles.length, errors }
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = process.cwd()
  const result = checkScenarioDrift(repoRoot)
  if (result.checked === 0) {
    console.log('No scenarios found. Skipping drift check.')
    process.exit(0)
  }
  if (result.errors.length === 0) {
    console.log(`OK — ${result.checked} scenario(s) in sync with their specs.`)
    process.exit(0)
  }
  console.error(`Drift detected in ${result.errors.length} scenario(s):`)
  for (const err of result.errors) console.error(`  - ${err}`)
  process.exit(1)
}
