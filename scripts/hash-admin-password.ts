import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { hashPassword } from '@/lib/auth/password'

async function readPassword(): Promise<string> {
  const inlinePassword = process.argv[2]
  if (inlinePassword) return inlinePassword

  const readline = createInterface({ input, output })
  const password = await readline.question('Admin password: ')
  readline.close()
  return password
}

const password = await readPassword()
if (!password) {
  console.error('Password cannot be empty')
  process.exit(1)
}

console.log(await hashPassword(password))
