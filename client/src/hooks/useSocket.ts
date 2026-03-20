import { useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import { connectSocket, disconnectSocket } from '../lib/socket'
import type { ServerWithChannels, Message } from '@discord/shared'
import type { PresenceStatus } from '../store'

/**
 * Manages Socket.io lifecycle and READY hydration.
 * 
 * Implements the Hydration Gap fix from ARCHITECTURE.md Section 7.1:
 * 1. Receives 'ready' → buffers all events
 * 2. Hydrates Zustand from READY payload
 * 3. Drains earlyEventQueue → events applied
 * 4. Emits 'ready:ack' → server joins rooms + broadcasts presence
 */
export function useSocket() {
  const token = useAppStore((s) => s.token)
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  const connectedRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || !token || connectedRef.current) return

    connectedRef.current = true
    const socket = connectSocket(token)

    const {
      setBuffering,
      hydrateFromReady,
      drainEarlyEventQueue,
      pushEvent,
      addMessage,
      setPresence,
      addTypingUser,
      removeTypingUser,
      removeServer,
      addChannel,
      removeChannel,
    } = useAppStore.getState()

    // Helper: route event through buffer or apply directly
    function handleEvent(type: string, payload: unknown) {
      if (useAppStore.getState().isBuffering) {
        pushEvent({ type, payload })
      } else {
        applyEvent(type, payload)
      }
    }

    function applyEvent(type: string, payload: unknown) {
      switch (type) {
        case 'message:new': {
          const p = payload as { channelId: string; message: Message }
          addMessage(p.channelId, p.message)
          break
        }
        case 'presence:changed': {
          const p = payload as { userId: string; status: PresenceStatus }
          setPresence(p.userId, p.status)
          break
        }
        case 'typing:update': {
          const p = payload as { channelId: string; userId: string }
          addTypingUser(p.channelId, p.userId)
          // Auto-remove after 3 seconds
          setTimeout(() => removeTypingUser(p.channelId, p.userId), 3000)
          break
        }
        case 'server:member-joined': {
          // Member list is lazy-loaded — this is just for notifications
          break
        }
        case 'server:member-left': {
          const p = payload as { serverId: string; userId: string }
          // If the current user left, remove the server
          if (p.userId === useAppStore.getState().user?.id) {
            removeServer(p.serverId)
          }
          break
        }
        case 'channel:created': {
          const p = payload as { serverId: string; channel: ServerWithChannels['channels'][0] }
          addChannel(p.serverId, p.channel)
          break
        }
        case 'channel:deleted': {
          const p = payload as { serverId: string; channelId: string }
          removeChannel(p.serverId, p.channelId)
          break
        }
      }
    }

    // ── READY event (Section 7.1 Step 5) ──────────────
    socket.on('ready', (payload) => {
      console.log('🚀 READY payload received', payload)

      // Step 5a: Enable buffering
      setBuffering(true)

      // Step 5b: Hydrate all stores
      hydrateFromReady(payload)

      // Step 5c-d: Drain queue and disable buffering
      drainEarlyEventQueue()

      // Step 5e: Tell server we're ready for real-time events
      socket.emit('ready:ack')
    })

    // ── Event listeners ──────────────────────────────
    socket.on('message:new', (payload) =>
      handleEvent('message:new', payload)
    )
    socket.on('message:updated', (payload) =>
      handleEvent('message:updated', payload)
    )
    socket.on('message:deleted', (payload) =>
      handleEvent('message:deleted', payload)
    )
    socket.on('presence:changed', (payload) =>
      handleEvent('presence:changed', payload)
    )
    socket.on('typing:update', (payload) =>
      handleEvent('typing:update', payload)
    )
    socket.on('server:member-joined', (payload) =>
      handleEvent('server:member-joined', payload)
    )
    socket.on('server:member-left', (payload) =>
      handleEvent('server:member-left', payload)
    )
    socket.on('channel:created', (payload) =>
      handleEvent('channel:created', payload)
    )
    socket.on('channel:deleted', (payload) =>
      handleEvent('channel:deleted', payload)
    )
    socket.on('voice:user-joined', (payload) =>
      handleEvent('voice:user-joined', payload)
    )
    socket.on('voice:user-left', (payload) =>
      handleEvent('voice:user-left', payload)
    )

    return () => {
      connectedRef.current = false
      disconnectSocket()
    }
  }, [isAuthenticated, token])
}
