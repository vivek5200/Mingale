import { useState, useRef, useCallback } from 'react'
import { getSocket } from '../../lib/socket'

interface Props {
  channelId: string
}

export default function MessageInput({ channelId }: Props) {
  const [content, setContent] = useState('')
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSend = useCallback(() => {
    const trimmed = content.trim()
    if (!trimmed) return

    const socket = getSocket()
    socket.emit('message:send', {
      channelId,
      content: trimmed,
      type: 'text',
    })

    setContent('')
  }, [content, channelId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setContent(e.target.value)

    // Emit typing indicator (debounced to every 2 seconds)
    if (!typingTimeoutRef.current) {
      const socket = getSocket()
      socket.emit('typing:start', { channelId })
      typingTimeoutRef.current = setTimeout(() => {
        typingTimeoutRef.current = null
      }, 2000)
    }
  }

  return (
    <div className="flex items-center bg-bg-modifier-hover rounded-lg px-4">
      {/* Plus button (for future attachments) */}
      <button className="text-text-muted hover:text-text-secondary transition-colors mr-3 text-xl">
        +
      </button>

      <input
        id="message-input"
        type="text"
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Message #channel"
        className="flex-1 bg-transparent py-2.5 text-text-primary text-sm outline-none
                   placeholder:text-text-muted"
      />

      {/* Send button (visible when there's content) */}
      {content.trim() && (
        <button
          onClick={handleSend}
          className="text-blurple hover:text-blurple-hover transition-colors ml-2"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      )}
    </div>
  )
}
