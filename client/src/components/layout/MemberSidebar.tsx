import { useAppStore } from '../../store'
import type { PresenceStatus } from '../../store'
import { trpc } from '../../lib/trpc'

interface Props {
  serverId: string | null
}

export default function MemberSidebar({ serverId }: Props) {
  const onlineUsers = useAppStore((s) => s.onlineUsers)

  // Lazy-load members when a server is selected
  const membersQuery = trpc.server.getMembers.useInfiniteQuery(
    { serverId: serverId!, limit: 100 },
    {
      enabled: !!serverId,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: 30_000,
    }
  )

  if (!serverId) return null

  const allMembers = membersQuery.data?.pages?.flatMap((p) => p.members) ?? []

  // Split into online/offline using presence store
  const online = allMembers.filter((m) => onlineUsers.has(m.userId))
  const offline = allMembers.filter((m) => !onlineUsers.has(m.userId))

  const getStatus = (userId: string): PresenceStatus =>
    onlineUsers.get(userId) ?? 'offline'

  const statusColor: Record<PresenceStatus, string> = {
    online: 'bg-status-online',
    idle: 'bg-status-idle',
    dnd: 'bg-status-dnd',
    offline: 'bg-status-offline',
  }

  const renderMember = (member: typeof allMembers[0]) => (
    <div
      key={member.userId}
      className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-bg-modifier-hover
                 transition-colors cursor-pointer group"
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div className={`w-8 h-8 rounded-full bg-blurple/70 flex items-center justify-center text-white text-xs font-semibold
                        ${!onlineUsers.has(member.userId) ? 'opacity-40' : ''}`}>
          {member.avatarUrl ? (
            <img src={member.avatarUrl} alt={member.username} className="w-full h-full rounded-full object-cover" />
          ) : (
            member.username.charAt(0).toUpperCase()
          )}
        </div>
        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-primary
                        ${statusColor[getStatus(member.userId)]}`} />
      </div>

      {/* Name */}
      <span className={`text-sm truncate ${onlineUsers.has(member.userId) ? 'text-text-secondary' : 'text-text-muted opacity-60'}`}>
        {member.username}
      </span>
    </div>
  )

  return (
    <aside className="w-[240px] bg-bg-secondary shrink-0 overflow-y-auto no-select">
      <div className="px-4 py-4 space-y-4">
        {/* Online section */}
        {online.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase text-text-muted tracking-wide px-1 mb-2">
              Online — {online.length}
            </h3>
            {online.map(renderMember)}
          </div>
        )}

        {/* Offline section */}
        {offline.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase text-text-muted tracking-wide px-1 mb-2">
              Offline — {offline.length}
            </h3>
            {offline.map(renderMember)}
          </div>
        )}

        {/* Loading state */}
        {membersQuery.isLoading && (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 border-2 border-blurple border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Load more */}
        {membersQuery.hasNextPage && (
          <button
            onClick={() => membersQuery.fetchNextPage()}
            disabled={membersQuery.isFetchingNextPage}
            className="w-full text-xs text-text-link hover:underline py-2"
          >
            {membersQuery.isFetchingNextPage ? 'Loading...' : 'Load more members'}
          </button>
        )}
      </div>
    </aside>
  )
}
