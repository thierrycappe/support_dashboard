import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { authorizeAdminCredentials } from '@/lib/auth/admin'

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60,
    updateAge: 60 * 60,
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: authorizeAdminCredentials,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    jwt({ token, user }) {
      if (user?.role) token.role = user.role
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? 'admin'
        session.user.role = token.role === 'SUPPORT' ? 'SUPPORT' : 'ADMIN'
      }
      return session
    },
  },
})
