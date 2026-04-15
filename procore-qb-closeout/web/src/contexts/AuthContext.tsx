import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const ALLOWED_DOMAIN = 'clipper.construction'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  sendMagicLink: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  isAllowedEmail: (email: string) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const isAllowedEmail = (email: string): boolean => {
    const domain = email.split('@')[1]?.toLowerCase()
    return domain === ALLOWED_DOMAIN
  }

  const sendMagicLink = async (email: string): Promise<{ error: string | null }> => {
    if (!isAllowedEmail(email)) {
      return { error: `Only @${ALLOWED_DOMAIN} email addresses are allowed.` }
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    })

    if (error) {
      return { error: error.message }
    }

    return { error: null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const value = {
    user,
    session,
    loading,
    sendMagicLink,
    signOut,
    isAllowedEmail,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
