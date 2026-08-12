import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type Oklch = readonly [lightness: number, chroma: number, hue: number]
type ThemeTokens = Record<'background' | 'surface' | 'surface-subtle' | 'border' | 'border-strong' | 'focus', Oklch>

const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')

describe('design accessibility contract', () => {
  it.each([
    ['light', ':root'],
    ['dark', ":root[data-theme='dark']"],
  ] as const)('%s shipped boundaries and focus rings maintain 3:1 contrast on adjacent surfaces', (_name, selector) => {
    expect(minimumBoundaryContrast(parseThemeTokens(css, selector))).toBeGreaterThanOrEqual(3)
  })

  it('fails the contrast contract when a shipped boundary token regresses', () => {
    const mutatedCss = css.replace(
      /(:root\s*\{[\s\S]*?--border:\s*)oklch\([^)]+\)/,
      '$1oklch(0.855 0.014 248)',
    )
    expect(minimumBoundaryContrast(parseThemeTokens(mutatedCss, ':root'))).toBeLessThan(3)
  })

  it('gives mobile navigation links, theme choices, and scroll controls 44px targets', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.nav-link,\s*\.theme-option\s*\{\s*min-height:\s*44px/)
    expect(css).toMatch(/@media \(max-width: 960px\)[\s\S]*?\.nav-rail\[data-overflow='true'\][\s\S]*?grid-template-columns:\s*44px minmax\(0, 1fr\) 44px/)
    expect(css).toMatch(/\.nav-scroll-control\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px/)
  })

  it('uses danger boundaries and focus rings for invalid controls', () => {
    expect(css).toMatch(/\[aria-invalid='true'\]\s*\{\s*border-color:\s*var\(--danger\)/)
    expect(css).toMatch(/\[aria-invalid='true'\]:focus-visible\s*\{\s*outline-color:\s*var\(--danger\)/)
  })

  it('keeps the escalation queue compact on desktop and structurally usable on narrow screens', () => {
    expect(css).toMatch(/\.summary-ledger\s*\{[\s\S]*?gap:\s*var\(--space-2\)/)
    expect(css).toMatch(/\.queue-filters\s*\{[\s\S]*?gap:\s*var\(--space-3\)/)
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.queue-filters\s*\{[\s\S]*?grid-template-columns:\s*1fr/)
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.queue-heading\s*\{[\s\S]*?align-items:\s*flex-start/)
  })

  it('ships tokenized operational tabs, ledgers, and 44px mobile controls', () => {
    expect(css).toMatch(/\.operations-tabs\s*\{[\s\S]*?display:\s*flex[\s\S]*?gap:\s*var\(--space-2\)/)
    expect(css).toMatch(/\.operations-tabs\s+a\[aria-current='page'\]\s*\{[\s\S]*?background:\s*var\(--accent\)/)
    expect(css).toMatch(/\.operations-strip\s*\{[\s\S]*?border:\s*1px solid var\(--border\)/)
    expect(css).toMatch(/\.operations-section\s*\{[\s\S]*?border-top:\s*1px solid var\(--border\)/)
    expect(css).toMatch(/\.group-row,\s*\.channel-row\s*\{[\s\S]*?display:\s*grid/)
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.operations-tabs a[\s\S]*?min-height:\s*44px/)
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.inline-operation-form,\s*\.channel-form[\s\S]*?grid-template-columns:\s*1fr/)
  })

  it('stacks operational secondary metadata and keeps status badges intrinsic', () => {
    expect(css).toMatch(/\.table-secondary\s*\{[\s\S]*?display:\s*block/)
    expect(css).toMatch(/\.group-badges\s*\{[\s\S]*?align-items:\s*start/)
    expect(css).toMatch(/\.group-badges\s+\.ui-badge\s*\{[\s\S]*?justify-self:\s*start[\s\S]*?width:\s*max-content/)
    expect(css).toMatch(/\.channel-row\s*>\s*\.ui-badge\s*\{[\s\S]*?justify-self:\s*start[\s\S]*?width:\s*max-content/)
  })

  it('contains team ledgers and form controls inside the 390px viewport', () => {
    expect(css).toMatch(/\.operations-section\s+:is\(input, select, textarea\)\s*\{[\s\S]*?min-width:\s*0[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*100%/)
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.group-ledger,\s*\.channel-ledger,\s*\.group-row,\s*\.channel-row,\s*\.inline-operation-form,\s*\.channel-form,\s*\.group-membership-form,\s*\.channel-secret-replacement\s*\{[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%/)
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.group-row\s*>\s*\*,\s*\.channel-row\s*>\s*\*\s*\{[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%/)
  })
})

function parseThemeTokens(stylesheet: string, selector: string): ThemeTokens {
  const selectorPattern = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = stylesheet.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`))?.[1]
  if (!block) throw new Error(`Missing CSS block: ${selector}`)
  return Object.fromEntries(
    ['background', 'surface', 'surface-subtle', 'border', 'border-strong', 'focus'].map((token) => {
      const value = block.match(new RegExp(`--${token}:\\s*oklch\\(([^)]+)\\)`))?.[1]
      if (!value) throw new Error(`Missing OKLCH token: --${token}`)
      const channels = value.trim().split(/\s+/).map(Number)
      if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
        throw new Error(`Invalid OKLCH token: --${token}`)
      }
      return [token, channels as unknown as Oklch]
    }),
  ) as ThemeTokens
}

function minimumBoundaryContrast(tokens: ThemeTokens): number {
  return Math.min(
    ...[tokens.border, tokens['border-strong'], tokens.focus].flatMap((boundary) =>
      [tokens.background, tokens.surface, tokens['surface-subtle']].map((adjacent) => contrast(boundary, adjacent)),
    ),
  )
}

function contrast(left: Oklch, right: Oklch): number {
  const leftLuminance = relativeLuminance(left)
  const rightLuminance = relativeLuminance(right)
  return (Math.max(leftLuminance, rightLuminance) + 0.05) / (Math.min(leftLuminance, rightLuminance) + 0.05)
}

function relativeLuminance([lightness, chroma, hue]: Oklch): number {
  const radians = hue * Math.PI / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b
  const linearRed = 4.0767416621 * lPrime ** 3 - 3.3077115913 * mPrime ** 3 + 0.2309699292 * sPrime ** 3
  const linearGreen = -1.2684380046 * lPrime ** 3 + 2.6097574011 * mPrime ** 3 - 0.3413193965 * sPrime ** 3
  const linearBlue = -0.0041960863 * lPrime ** 3 - 0.7034186147 * mPrime ** 3 + 1.707614701 * sPrime ** 3
  return 0.2126 * clamp(linearRed) + 0.7152 * clamp(linearGreen) + 0.0722 * clamp(linearBlue)
}

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}
