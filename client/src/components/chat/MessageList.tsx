import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store'
import { trpc } from '../../lib/trpc'
import MessageItem from './MessageItem.tsx'

interface Props {
  channelId: string
}

export default function MessageList({ channelId }: Props) {
  const messagesByChannel = useAppStore((s) => s.messagesByChannel)
  const prependMessages = useAppStore((s) => s.prependMessages)
  const messages = messagesByChannel.get(channelId) ?? []
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevLengthRef = useRef(0)

  // Fetch message history
  const historyQuery = trpc.message.getHistory.useInfiniteQuery(
    { channelId, limit: 50 },
    {
      enabled: !!channelId,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: 60_000,
    }
  )

  // Hydrate Zustand from fetched pages (only on initial load)
  useEffect(() => {
    if (historyQuery.data && messages.length === 0) {
      const allMessages = historyQuery.data.pages
        .flatMap((p) => p.messages)
        .reverse() // API returns newest first, we want oldest first
      if (allMessages.length > 0) {
        prependMessages(
          channelId,
          allMessages,
          historyQuery.hasNextPage ?? false
        )
      }
    }
  }, [historyQuery.data, channelId, messages.length, prependMessages, historyQuery.hasNextPage])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevLengthRef.current = messages.length
  }, [messages.length])

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-y-auto">
      {/* Load more button */}
      {historyQuery.hasNextPage && (
        <div className="flex justify-center py-4">
          <button
            onClick={() => historyQuery.fetchNextPage()}
            disabled={historyQuery.isFetchingNextPage}
            className="text-xs text-text-link hover:underline"
          >
            {historyQuery.isFetchingNextPage ? 'Loading...' : 'Load older messages'}
          </button>
        </div>
      )}

      {/* Loading */}
      {historyQuery.isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blurple border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!historyQuery.isLoading && messages.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-end pb-8 px-4">
          <div className="w-16 h-16 rounded-full bg-bg-secondary flex items-center justify-center mb-4">
            <span className="text-3xl">#</span>
          </div>
          <h3 className="text-xl font-bold text-text-primary mb-2">Welcome to #channel!</h3>
          <p className="text-text-muted text-sm text-center">
            This is the start of this channel. Send a message to get the conversation going!
          </p>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1" />
      <div className="px-4 py-2">
        {messages.map((message, i) => {
          const prevMessage = messages[i - 1]
          const showHeader =
            !prevMessage ||
            prevMessage.userId !== message.userId ||
            new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime() > 5 * 60 * 1000
          return (
            <MessageItem key={message.id} message={message} showHeader={showHeader} />
          )
        })}
      </div>

      <div ref={bottomRef} />
    </div>
  )
}
