import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { Inter } from 'next/font/google'
import { normalizeTheme } from '@/components/theme'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Support Control Tower',
  description: 'Central dashboard for feedback tickets across applications.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const theme = normalizeTheme((await cookies()).get('support-theme')?.value)

  return (
    <html lang="en" data-theme={theme === 'system' ? undefined : theme}>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
