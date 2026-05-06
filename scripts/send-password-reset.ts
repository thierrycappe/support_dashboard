import { requestPasswordResetEmail } from '@/lib/auth/password-reset'

const email = process.argv[2]?.trim()

if (!email) {
  console.error('Usage: npm run auth:send-password-reset -- user@example.com')
  process.exit(1)
}

const result = await requestPasswordResetEmail({ email })
console.log(`Password reset email result: ${result}`)

if (result !== 'sent') {
  process.exitCode = 1
}
