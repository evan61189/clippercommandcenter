import { Link } from 'react-router-dom'
import { Ship } from 'lucide-react'

export default function ResetPassword() {
  return (
    <div className="min-h-screen bg-clipper-black flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-clipper-gold rounded-lg mb-5">
          <Ship className="w-7 h-7 text-clipper-black" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">No Password Needed</h1>
        <p className="text-sm text-gray-400 mb-6">
          Clipper Command Terminal uses magic links — no passwords to remember or reset.
        </p>
        <Link
          to="/login"
          className="inline-flex items-center px-4 py-2.5 rounded-lg text-sm font-semibold bg-clipper-gold text-clipper-black hover:bg-clipper-gold-dark transition-colors"
        >
          Go to Sign In
        </Link>
      </div>
    </div>
  )
}
