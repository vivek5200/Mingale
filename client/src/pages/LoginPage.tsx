import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { trpc } from '../lib/trpc'
import { useAppStore } from '../store'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const setAuth = useAppStore((s) => s.setAuth)
  const navigate = useNavigate()

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      setAuth(data.user, data.token)
      navigate('/')
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    loginMutation.mutate({ email, password })
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg-tertiary">
      <div className="w-full max-w-md rounded-md bg-bg-primary p-8 shadow-2xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-text-primary mb-2">Welcome back!</h1>
          <p className="text-text-muted text-sm">We're so excited to see you again!</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded bg-red/10 border border-red/30 px-4 py-2 text-red text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase text-text-muted mb-2 tracking-wide">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-sm bg-bg-tertiary px-3 py-2.5 text-text-primary text-base outline-none
                         transition-colors focus:ring-2 focus:ring-blurple placeholder:text-text-muted"
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-text-muted mb-2 tracking-wide">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-sm bg-bg-tertiary px-3 py-2.5 text-text-primary text-base outline-none
                         transition-colors focus:ring-2 focus:ring-blurple placeholder:text-text-muted"
              placeholder="Enter your password"
            />
          </div>

          <button
            id="login-submit"
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full rounded-sm bg-blurple px-4 py-2.5 text-white font-medium text-base
                       transition-colors hover:bg-blurple-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loginMutation.isPending ? 'Logging in...' : 'Log In'}
          </button>

          <p className="text-sm text-text-muted mt-2">
            Need an account?{' '}
            <Link to="/register" className="text-text-link hover:underline">
              Register
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
