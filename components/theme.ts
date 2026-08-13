export type ThemeChoice = 'light' | 'dark' | 'system'

export function normalizeTheme(value: string | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

export function persistTheme(choice: ThemeChoice): void {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', choice)
  document.cookie = `support-theme=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`
}
