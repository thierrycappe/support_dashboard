import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type Oklch = readonly [lightness: number, chroma: number, hue: number]

const themes = {
  light: {
    background: [0.975, 0.006, 248],
    surface: [0.995, 0.004, 248],
    surfaceSubtle: [0.95, 0.01, 248],
    border: [0.58, 0.025, 248],
    borderStrong: [0.54, 0.035, 248],
    focus: [0.58, 0.13, 252],
  },
  dark: {
    background: [0.17, 0.012, 248],
    surface: [0.21, 0.014, 248],
    surfaceSubtle: [0.255, 0.018, 248],
    border: [0.55, 0.035, 248],
    borderStrong: [0.61, 0.04, 248],
    focus: [0.65, 0.13, 252],
  },
} satisfies Record<string, Record<string, Oklch>>

describe('design accessibility contract', () => {
  it.each(Object.entries(themes))('%s boundaries and focus rings maintain 3:1 contrast on adjacent surfaces', (_name, tokens) => {
    for (const boundary of [tokens.border, tokens.borderStrong, tokens.focus]) {
      for (const adjacent of [tokens.background, tokens.surface, tokens.surfaceSubtle]) {
        expect(contrast(boundary, adjacent)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('gives mobile navigation links and theme choices 44px targets', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.nav-link,\s*\.theme-option\s*\{\s*min-height:\s*44px/)
  })

  it('uses danger boundaries and focus rings for invalid controls', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')
    expect(css).toMatch(/\[aria-invalid='true'\]\s*\{\s*border-color:\s*var\(--danger\)/)
    expect(css).toMatch(/\[aria-invalid='true'\]:focus-visible\s*\{\s*outline-color:\s*var\(--danger\)/)
  })
})

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
