import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkScenarioDrift, computeScenarioBodyHash } from './check-scenario-drift.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'scn-drift-'))
  mkdirSync(join(tmp, 'scenarios', 'auth'), { recursive: true })
  mkdirSync(join(tmp, 'e2e', 'scenarios', 'auth'), { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('computeScenarioBodyHash', () => {
  it('returns the same hash for identical bodies regardless of frontmatter', () => {
    const bodyA = '---\nid: SCN-001\nspec_hash: abcd1234\n---\n\n# title\n\nbody'
    const bodyB = '---\nid: SCN-001\nspec_hash: ffffffff\n---\n\n# title\n\nbody'
    expect(computeScenarioBodyHash(bodyA)).toBe(computeScenarioBodyHash(bodyB))
  })

  it('returns different hashes when the body differs', () => {
    const a = '---\nid: SCN-001\n---\n\n# title\n\nbody A'
    const b = '---\nid: SCN-001\n---\n\n# title\n\nbody B'
    expect(computeScenarioBodyHash(a)).not.toBe(computeScenarioBodyHash(b))
  })

  it('returns an 8-char hex prefix', () => {
    const h = computeScenarioBodyHash('---\nid: SCN-001\n---\n\nbody')
    expect(h).toMatch(/^[a-f0-9]{8}$/)
  })
})

describe('checkScenarioDrift', () => {
  it('returns no errors when scenario hash matches spec header hash', () => {
    const scn = `---
id: SCN-001
title: Test
area: auth
status: active
last_synced: 2026-05-02
linked_spec: e2e/scenarios/auth/SCN-001.spec.ts
spec_hash: __FILL__
---

# SCN-001
body content
`
    const bodyHash = computeScenarioBodyHash(scn)
    const scnFinal = scn.replace('__FILL__', bodyHash)
    writeFileSync(join(tmp, 'scenarios', 'auth', 'SCN-001-test.md'), scnFinal)
    writeFileSync(
      join(tmp, 'e2e', 'scenarios', 'auth', 'SCN-001.spec.ts'),
      `// scaffold:scenario:SCN-001:${bodyHash}\nimport { test } from '@playwright/test'\ntest('x', async () => {})\n`
    )

    const result = checkScenarioDrift(tmp)
    expect(result.errors).toEqual([])
    expect(result.checked).toBe(1)
  })

  it('reports drift when scenario body changed but spec wasn’t regenerated', () => {
    const scn = `---
id: SCN-002
title: Test
area: auth
status: active
last_synced: 2026-05-02
linked_spec: e2e/scenarios/auth/SCN-002.spec.ts
spec_hash: deadbeef
---

# SCN-002
new body
`
    writeFileSync(join(tmp, 'scenarios', 'auth', 'SCN-002-test.md'), scn)
    writeFileSync(
      join(tmp, 'e2e', 'scenarios', 'auth', 'SCN-002.spec.ts'),
      `// scaffold:scenario:SCN-002:deadbeef\nimport { test } from '@playwright/test'\ntest('x', async () => {})\n`
    )

    const result = checkScenarioDrift(tmp)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain('SCN-002')
    expect(result.errors[0]).toContain('drift')
  })

  it('reports missing spec file', () => {
    const scn = `---
id: SCN-003
title: Test
area: auth
status: active
last_synced: 2026-05-02
linked_spec: e2e/scenarios/auth/SCN-003.spec.ts
spec_hash: 12345678
---

# SCN-003
body
`
    writeFileSync(join(tmp, 'scenarios', 'auth', 'SCN-003-test.md'), scn)
    // No spec file written.

    const result = checkScenarioDrift(tmp)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain('SCN-003')
    expect(result.errors[0]).toContain('missing')
  })

  it('reports when spec exists but lacks header marker', () => {
    const scn = `---
id: SCN-004
title: Test
area: auth
status: active
last_synced: 2026-05-02
linked_spec: e2e/scenarios/auth/SCN-004.spec.ts
spec_hash: __FILL__
---

# SCN-004
body
`
    const bodyHash = computeScenarioBodyHash(scn)
    const scnFinal = scn.replace('__FILL__', bodyHash)
    writeFileSync(join(tmp, 'scenarios', 'auth', 'SCN-004-test.md'), scnFinal)
    writeFileSync(
      join(tmp, 'e2e', 'scenarios', 'auth', 'SCN-004.spec.ts'),
      `import { test } from '@playwright/test'\ntest('x', async () => {})\n`
    )

    const result = checkScenarioDrift(tmp)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain('SCN-004')
    expect(result.errors[0]).toContain('header marker')
  })

  it('reports header-hash drift when frontmatter is refreshed but spec wasn\'t', () => {
    const scn = `---
id: SCN-005
title: Test
area: auth
status: active
last_synced: 2026-05-02
linked_spec: e2e/scenarios/auth/SCN-005.spec.ts
spec_hash: __FILL__
---

# SCN-005
new body content
`
    const bodyHash = computeScenarioBodyHash(scn)
    const scnFinal = scn.replace('__FILL__', bodyHash)
    writeFileSync(join(tmp, 'scenarios', 'auth', 'SCN-005-test.md'), scnFinal)
    // Spec file has a STALE header hash (deadbeef), not the current bodyHash
    writeFileSync(
      join(tmp, 'e2e', 'scenarios', 'auth', 'SCN-005.spec.ts'),
      `// scaffold:scenario:SCN-005:deadbeef\nimport { test } from '@playwright/test'\ntest('x', async () => {})\n`
    )

    const result = checkScenarioDrift(tmp)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain('SCN-005')
    expect(result.errors[0]).toContain('drift')
    expect(result.errors[0]).toContain('deadbeef')
  })

  it('returns checked=0 when no scenarios exist', () => {
    const result = checkScenarioDrift(tmp)
    expect(result.errors).toEqual([])
    expect(result.checked).toBe(0)
  })
})
