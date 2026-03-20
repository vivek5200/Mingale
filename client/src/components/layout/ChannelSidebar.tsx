import { useNavigate, useParams } from 'react-router-dom'
import type { ServerWithChannels } from '@discord/shared'
import UserPanel from './UserPanel'

interface Props {
  server: ServerWithChannels | null
}

export default function ChannelSidebar({ server }: Props) {
  const { channelId } = useParams()
  const navigate = useNavigate()

  if (!server) {
    return (
      <aside className="flex flex-col w-[240px] bg-bg-secondary shrink-0">
        <div className="flex items-center h-12 px-4 border-b border-bg-tertiary shadow-sm">
          <h2 className="text-text-primary font-semibold truncate">Mingle</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-text-muted text-sm px-4 text-center">
            Join or create a server to get started
          </p>
        </div>
        <UserPanel />
      </aside>
    )
  }

  const textChannels = server.channels.filter((c) => c.type === 'text')
  const voiceChannels = server.channels.filter((c) => c.type === 'voice')

  return (
    <aside className="flex flex-col w-[240px] bg-bg-secondary shrink-0">
      {/* Server header */}
      <div className="flex items-center h-12 px-4 border-b border-bg-tertiary shadow-sm
                      hover:bg-bg-modifier-hover cursor-pointer transition-colors no-select">
        <h2 className="text-text-primary font-semibold truncate flex-1">{server.name}</h2>
        <svg className="w-4 h-4 text-text-muted" fill="currentColor" viewBox="0 0 20 20">
          <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
        </svg>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {/* Text channels */}
        {textChannels.length > 0 && (
          <div>
            <h3 className="flex items-center px-1 mb-1 text-xs font-bold uppercase text-text-muted tracking-wide
                           hover:text-text-secondary cursor-pointer no-select">
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
              </svg>
              Text Channels
            </h3>
            {textChannels.map((channel) => (
              <button
                key={channel.id}
                id={`channel-${channel.id}`}
                onClick={() => navigate(`/servers/${server.id}/channels/${channel.id}`)}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-sm text-sm cursor-pointer
                           transition-colors group
                           ${channel.id === channelId
                             ? 'bg-bg-modifier-active text-text-primary'
                             : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-secondary'
                           }`}
              >
                <span className="text-text-muted text-lg leading-none">#</span>
                <span className="truncate">{channel.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Voice channels */}
        {voiceChannels.length > 0 && (
          <div>
            <h3 className="flex items-center px-1 mb-1 text-xs font-bold uppercase text-text-muted tracking-wide
                           hover:text-text-secondary cursor-pointer no-select">
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
              </svg>
              Voice Channels
            </h3>
            {voiceChannels.map((channel) => (
              <button
                key={channel.id}
                id={`voice-channel-${channel.id}`}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-sm text-sm cursor-pointer
                           text-text-muted hover:bg-bg-modifier-hover hover:text-text-secondary
                           transition-colors"
              >
                <span className="text-lg leading-none">🔊</span>
                <span className="truncate">{channel.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* User panel at bottom */}
      <UserPanel />
    </aside>
  )
}
