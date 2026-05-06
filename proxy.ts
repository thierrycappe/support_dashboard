export { auth as proxy } from '@/auth'

export const config = {
  matcher: [
    '/((?!api/auth|api/feedback/ingest|forgot-password|reset-password|_next/static|_next/image|favicon.ico).*)',
  ],
}
