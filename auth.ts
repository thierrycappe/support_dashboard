import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials)
        if (!parsed.success) return null

        const adminEmail = process.env.SUPPORT_DASHBOARD_ADMIN_EMAIL?.trim()
        const adminPassword = process.env.SUPPORT_DASHBOARD_ADMIN_PASSWORD

        if (!adminEmail || !adminPassword) return null
        if (
          parsed.data.email.trim().toLowerCase() !== adminEmail.toLowerCase() ||
          parsed.data.password !== adminPassword
        ) {
          return null
        }

        return {
          id: 'admin',
          email: adminEmail,
          name: 'Support dashboard admin',
        }
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? 'admin'
      }
      return session
    },
  },
})
