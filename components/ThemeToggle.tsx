'use client'

import { useState } from 'react'
import type { ThemeChoice } from '@/components/theme'
import { persistTheme } from '@/components/theme'

const choices: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

export default function ThemeToggle({ initialTheme }: { initialTheme: ThemeChoice }) {
  const [theme, setTheme] = useState(initialTheme)

  function selectTheme(choice: ThemeChoice) {
    setTheme(choice)
    persistTheme(choice)
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {choices.map((choice) => (
        <button
          key={choice.value}
          className="theme-option"
          type="button"
          aria-label={`Use ${choice.value} theme`}
          aria-pressed={theme === choice.value}
          onClick={() => selectTheme(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  )
}
