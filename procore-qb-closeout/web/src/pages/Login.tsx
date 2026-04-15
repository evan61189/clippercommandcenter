import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Loader2, Mail, AlertCircle, CheckCircle2, Ship } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const { sendMagicLink, isAllowedEmail } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!isAllowedEmail(email)) {
      setError('Only @clipper.construction email addresses are allowed.')
      return
    }

    setLoading(true)

    try {
      const { error } = await sendMagicLink(email)
      if (error) {
        setError(error)
      } else {
        setSent(true)
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-clipper-black flex flex-col items-center justify-center px-4">
      {/* Gold accent line at top */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-clipper-gold" />

      <div className="w-full max-w-sm">
        {/* Logo & Branding */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-clipper-gold rounded-lg mb-5">
            <Ship className="w-7 h-7 text-clipper-black" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Clipper Command Terminal
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Clipper Construction
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-2xl p-8">
          {sent ? (
            /* Success state */
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-emerald-100 rounded-full mb-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Check your inbox</h2>
              <p className="text-sm text-gray-600 mb-6">
                We sent a sign-in link to<br />
                <span className="font-medium text-gray-900">{email}</span>
              </p>
              <button
                onClick={() => { setSent(false); setEmail('') }}
                className="text-sm text-gray-500 hover:text-clipper-black transition-colors"
              >
                Use a different email
              </button>
            </div>
          ) : (
            /* Email input state */
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Sign in</h2>
              <p className="text-sm text-gray-500 mb-6">
                Enter your email and we'll send you a magic link.
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@clipper.construction"
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-clipper-gold focus:border-clipper-gold"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center py-2.5 px-4 rounded-lg text-sm font-semibold bg-clipper-black text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-clipper-gold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    'Send Magic Link'
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          Only @clipper.construction emails are authorized.
        </p>
      </div>
    </div>
  )
}
