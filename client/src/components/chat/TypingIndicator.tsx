import { useAppStore } from '../../store'

interface Props {
  channelId: string
}

export default function TypingIndicator({ channelId }: Props) {
  const typingUsers = useAppStore((s) => s.typingUsers)
  const currentUserId = useAppStore((s) => s.user?.id)
  const typing = typingUsers.get(channelId)

  if (!typing || typing.size === 0) return <div className="h-5" />

  // Filter out current user
  const otherTyping = Array.from(typing).filter((id) => id !== currentUserId)
  if (otherTyping.length === 0) return <div className="h-5" />

  const text =
    otherTyping.length === 1
      ? `Someone is typing...`
      : otherTyping.length <= 3
        ? `${otherTyping.length} people are typing...`
        : `Several people are typing...`

  return (
    <div className="h-5 flex items-center gap-1.5 text-xs text-text-muted">
      {/* Animated dots */}
      <span className="flex gap-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:300ms]" />
      </span>
      <span>{text}</span>
    </div>
  )
}
