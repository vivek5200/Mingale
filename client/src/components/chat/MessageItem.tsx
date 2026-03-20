import type { Message } from '@discord/shared'

interface Props {
  message: Message
  showHeader: boolean
}

function formatTimestamp(dateStr: string) {
  const date = new Date(dateStr)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (isToday) return `Today at ${time}`

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`

  return `${date.toLocaleDateString()} ${time}`
}

export default function MessageItem({ message, showHeader }: Props) {
  const authorName = message.author?.username ?? 'Unknown'
  const authorInitial = authorName.charAt(0).toUpperCase()

  if (showHeader) {
    return (
      <div className="mt-4 first:mt-0 flex gap-4 py-0.5 hover:bg-bg-modifier-hover/30 px-1 rounded-sm group">
        {/* Avatar */}
        <div className="shrink-0 pt-0.5">
          <div className="w-10 h-10 rounded-full bg-blurple/70 flex items-center justify-center text-white text-sm font-semibold">
            {message.author?.avatarUrl ? (
              <img src={message.author.avatarUrl} alt={authorName} className="w-full h-full rounded-full object-cover" />
            ) : (
              authorInitial
            )}
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-text-primary text-sm hover:underline cursor-pointer">
              {authorName}
            </span>
            <span className="text-xs text-text-muted">{formatTimestamp(message.createdAt)}</span>
          </div>
          <p className="text-text-secondary text-sm break-words leading-relaxed">{message.content}</p>
        </div>
      </div>
    )
  }

  // Compact mode — same author, no avatar
  return (
    <div className="flex gap-4 py-0.5 hover:bg-bg-modifier-hover/30 px-1 rounded-sm group">
      {/* Timestamp on hover (same width as avatar) */}
      <div className="w-10 shrink-0 flex items-center justify-center">
        <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p className="text-text-secondary text-sm break-words leading-relaxed min-w-0">{message.content}</p>
    </div>
  )
}
