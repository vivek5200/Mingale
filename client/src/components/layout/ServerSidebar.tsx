import { useNavigate, useParams } from 'react-router-dom'
import { useAppStore } from '../../store'

export default function ServerSidebar() {
  const servers = useAppStore((s) => s.servers)
  const { serverId } = useParams()
  const navigate = useNavigate()

  const handleServerClick = (id: string) => {
    const server = servers.find((s) => s.id === id)
    const firstTextChannel = server?.channels.find((c) => c.type === 'text')
    if (firstTextChannel) {
      navigate(`/servers/${id}/channels/${firstTextChannel.id}`)
    }
  }

  return (
    <nav className="flex flex-col items-center w-[72px] bg-bg-tertiary py-3 gap-2 shrink-0 overflow-y-auto no-select">
      {/* Home button */}
      <button
        id="home-button"
        onClick={() => navigate('/')}
        className="w-12 h-12 rounded-2xl bg-bg-primary flex items-center justify-center
                   text-text-primary font-bold text-xl hover:bg-blurple hover:rounded-xl
                   transition-all duration-200"
      >
        M
      </button>

      {/* Separator */}
      <div className="w-8 h-0.5 bg-bg-modifier-active rounded-full" />

      {/* Server icons */}
      {servers.map((server) => {
        const isActive = server.id === serverId
        return (
          <div key={server.id} className="relative group">
            {/* Active indicator pill */}
            {isActive && (
              <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-1 h-10 bg-text-primary rounded-r-full" />
            )}
            <button
              id={`server-${server.id}`}
              onClick={() => handleServerClick(server.id)}
              className={`w-12 h-12 flex items-center justify-center font-semibold text-sm
                         transition-all duration-200 cursor-pointer
                         ${isActive
                           ? 'bg-blurple rounded-xl text-white'
                           : 'bg-bg-primary rounded-2xl text-text-primary hover:bg-blurple hover:rounded-xl hover:text-white'
                         }`}
              title={server.name}
            >
              {server.iconUrl ? (
                <img
                  src={server.iconUrl}
                  alt={server.name}
                  className="w-full h-full rounded-inherit object-cover"
                />
              ) : (
                server.name.charAt(0).toUpperCase()
              )}
            </button>
            {/* Tooltip */}
            <div className="absolute left-16 top-1/2 -translate-y-1/2 bg-bg-floating text-text-primary
                            text-sm px-3 py-2 rounded-md shadow-xl whitespace-nowrap opacity-0
                            group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              {server.name}
            </div>
          </div>
        )
      })}

      {/* Add server button */}
      <button
        id="add-server-button"
        className="w-12 h-12 rounded-2xl bg-bg-primary flex items-center justify-center
                   text-green text-2xl font-light hover:bg-green hover:text-white hover:rounded-xl
                   transition-all duration-200"
      >
        +
      </button>
    </nav>
  )
}
