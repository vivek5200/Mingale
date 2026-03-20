import { useAppStore } from '../../store'

export default function UserPanel() {
  const user = useAppStore((s) => s.user)
  const logout = useAppStore((s) => s.logout)

  if (!user) return null

  return (
    <div className="flex items-center gap-2 bg-bg-tertiary/50 px-2 py-1.5 no-select">
      {/* Avatar with online indicator */}
      <div className="relative shrink-0">
        <div className="w-8 h-8 rounded-full bg-blurple flex items-center justify-center text-white text-sm font-semibold">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.username} className="w-full h-full rounded-full object-cover" />
          ) : (
            user.username.charAt(0).toUpperCase()
          )}
        </div>
        {/* Online dot */}
        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-status-online
                        border-[2.5px] border-bg-tertiary" />
      </div>

      {/* User info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate leading-tight">{user.username}</p>
        <p className="text-xs text-text-muted leading-tight">Online</p>
      </div>

      {/* Logout / settings button */}
      <button
        id="user-settings-button"
        onClick={logout}
        className="w-8 h-8 flex items-center justify-center rounded-sm text-text-muted
                   hover:bg-bg-modifier-hover hover:text-text-secondary transition-colors"
        title="Log out"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
        </svg>
      </button>
    </div>
  )
}
