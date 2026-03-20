import { Routes, Route, Navigate } from 'react-router-dom'
import { useAppStore } from './store'
import { useSocket } from './hooks/useSocket'
import AppLayout from './layouts/AppLayout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function GuestGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  // Initialize Socket.io when authenticated
  useSocket()

  return (
    <Routes>
      {/* Auth routes */}
      <Route
        path="/login"
        element={
          <GuestGuard>
            <LoginPage />
          </GuestGuard>
        }
      />
      <Route
        path="/register"
        element={
          <GuestGuard>
            <RegisterPage />
          </GuestGuard>
        }
      />

      {/* Main app — protected */}
      <Route
        path="/servers/:serverId/channels/:channelId"
        element={
          <AuthGuard>
            <AppLayout />
          </AuthGuard>
        }
      />

      {/* Default redirect */}
      <Route path="*" element={<DefaultRedirect />} />
    </Routes>
  )
}

function DefaultRedirect() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  const servers = useAppStore((s) => s.servers)

  if (!isAuthenticated) return <Navigate to="/login" replace />

  // Redirect to first server's first text channel
  if (servers.length > 0) {
    const server = servers[0]
    const textChannel = server.channels.find((c) => c.type === 'text')
    if (textChannel) {
      return (
        <Navigate
          to={`/servers/${server.id}/channels/${textChannel.id}`}
          replace
        />
      )
    }
  }

  // No servers yet — show the app layout anyway
  return (
    <AuthGuard>
      <AppLayout />
    </AuthGuard>
  )
}
