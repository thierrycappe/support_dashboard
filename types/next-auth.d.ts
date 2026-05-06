import 'next-auth'
import 'next-auth/jwt'

type SupportTowerRole = 'ADMIN' | 'SUPPORT'

declare module 'next-auth' {
  interface User {
    id: string
    role?: SupportTowerRole
  }

  interface Session {
    user?: {
      id: string
      role?: SupportTowerRole
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: SupportTowerRole
  }
}
