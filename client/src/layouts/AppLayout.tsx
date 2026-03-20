import { useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useAppStore } from '../store'
import ServerSidebar from '../components/layout/ServerSidebar'
import ChannelSidebar from '../components/layout/ChannelSidebar'
import MemberSidebar from '../components/layout/MemberSidebar'
import MessageList from '../components/chat/MessageList'
import MessageInput from '../components/chat/MessageInput'
import TypingIndicator from '../components/chat/TypingIndicator'

export default function AppLayout() {
  const { serverId, channelId } = useParams()
  const setActiveServer = useAppStore((s) => s.setActiveServer)
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const servers = useAppStore((s) => s.servers)

  // Sync URL params → Zustand
  useEffect(() => {
    if (serverId) setActiveServer(serverId)
    if (channelId) setActiveChannel(channelId)
  }, [serverId, channelId, setActiveServer, setActiveChannel])

  const activeServer = servers.find((s) => s.id === serverId)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-tertiary">
      {/* Server sidebar — 72px icon strip */}
      <ServerSidebar />

      {/* Channel sidebar — 240px */}
      <ChannelSidebar server={activeServer ?? null} />

      {/* Main content — flex 1 */}
      <main className="flex flex-1 flex-col bg-bg-primary min-w-0">
        {/* Channel header */}
        {activeServer && channelId && (
          <header className="flex h-12 items-center border-b border-bg-tertiary px-4 no-select shrink-0">
            <span className="text-text-muted mr-2">#</span>
            <h2 className="text-text-primary font-semibold text-base truncate">
              {activeServer.channels.find((c) => c.id === channelId)?.name ?? 'unknown'}
            </h2>
          </header>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-hidden">
          {channelId ? (
            <MessageList channelId={channelId} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-text-muted text-lg">Select a channel to start chatting</p>
            </div>
          )}
        </div>

        {/* Typing indicator + Input */}
        {channelId && (
          <div className="shrink-0 px-4 pb-6">
            <MessageInput channelId={channelId} />
            <TypingIndicator channelId={channelId} />
          </div>
        )}
      </main>

      {/* Member sidebar — 240px */}
      <MemberSidebar serverId={serverId ?? null} />
    </div>
  )
}
