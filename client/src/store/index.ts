import { create } from 'zustand'
import type { ServerWithChannels, UserProfile, Message } from '@discord/shared'

// ── Types ─────────────────────────────────────────────
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline'

interface QueuedEvent {
  type: string
  payload: unknown
}

// ── Store Shape ───────────────────────────────────────
interface AppState {
  // Auth
  user: UserProfile | null
  token: string | null
  isAuthenticated: boolean
  setAuth: (user: UserProfile, token: string) => void
  logout: () => void

  // Servers
  servers: ServerWithChannels[]
  activeServerId: string | null
  activeChannelId: string | null
  setActiveServer: (serverId: string) => void
  setActiveChannel: (channelId: string) => void
  hydrateFromReady: (payload: {
    user: UserProfile
    servers: ServerWithChannels[]
    presenceMap: Record<string, PresenceStatus>
  }) => void
  addServer: (server: ServerWithChannels) => void
  removeServer: (serverId: string) => void
  addChannel: (serverId: string, channel: ServerWithChannels['channels'][0]) => void
  removeChannel: (serverId: string, channelId: string) => void

  // Messages
  messagesByChannel: Map<string, Message[]>
  hasMoreMessages: Map<string, boolean>
  addMessage: (channelId: string, message: Message) => void
  prependMessages: (channelId: string, messages: Message[], hasMore: boolean) => void

  // Presence
  onlineUsers: Map<string, PresenceStatus>
  setPresence: (userId: string, status: PresenceStatus) => void
  removePresence: (userId: string) => void

  // Typing
  typingUsers: Map<string, Set<string>>
  addTypingUser: (channelId: string, userId: string) => void
  removeTypingUser: (channelId: string, userId: string) => void

  // Hydration Gap Protection (Section 7.1)
  isBuffering: boolean
  earlyEventQueue: QueuedEvent[]
  setBuffering: (enabled: boolean) => void
  pushEvent: (event: QueuedEvent) => void
  drainEarlyEventQueue: () => void
}

// ── Store ─────────────────────────────────────────────
export const useAppStore = create<AppState>((set, get) => ({
  // ── Auth ──────────────────────────
  user: null,
  token: localStorage.getItem('mingle-token'),
  isAuthenticated: !!localStorage.getItem('mingle-token'),

  setAuth: (user, token) => {
    localStorage.setItem('mingle-token', token)
    set({ user, token, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('mingle-token')
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      servers: [],
      activeServerId: null,
      activeChannelId: null,
      messagesByChannel: new Map(),
      onlineUsers: new Map(),
      typingUsers: new Map(),
    })
  },

  // ── Servers ───────────────────────
  servers: [],
  activeServerId: null,
  activeChannelId: null,

  setActiveServer: (serverId) => set({ activeServerId: serverId }),
  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  hydrateFromReady: (payload) => {
    const presenceMap = new Map<string, PresenceStatus>()
    for (const [userId, status] of Object.entries(payload.presenceMap)) {
      presenceMap.set(userId, status as PresenceStatus)
    }
    set({
      user: payload.user,
      servers: payload.servers,
      onlineUsers: presenceMap,
    })
  },

  addServer: (server) =>
    set((state) => ({ servers: [...state.servers, server] })),

  removeServer: (serverId) =>
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== serverId),
    })),

  addChannel: (serverId, channel) =>
    set((state) => ({
      servers: state.servers.map((s) =>
        s.id === serverId
          ? { ...s, channels: [...s.channels, channel] }
          : s
      ),
    })),

  removeChannel: (serverId, channelId) =>
    set((state) => ({
      servers: state.servers.map((s) =>
        s.id === serverId
          ? { ...s, channels: s.channels.filter((c) => c.id !== channelId) }
          : s
      ),
    })),

  // ── Messages ──────────────────────
  messagesByChannel: new Map(),
  hasMoreMessages: new Map(),

  addMessage: (channelId, message) =>
    set((state) => {
      const newMap = new Map(state.messagesByChannel)
      const existing = newMap.get(channelId) || []
      newMap.set(channelId, [...existing, message])
      return { messagesByChannel: newMap }
    }),

  prependMessages: (channelId, messages, hasMore) =>
    set((state) => {
      const msgMap = new Map(state.messagesByChannel)
      const existing = msgMap.get(channelId) || []
      msgMap.set(channelId, [...messages, ...existing])
      const moreMap = new Map(state.hasMoreMessages)
      moreMap.set(channelId, hasMore)
      return { messagesByChannel: msgMap, hasMoreMessages: moreMap }
    }),

  // ── Presence ──────────────────────
  onlineUsers: new Map(),

  setPresence: (userId, status) =>
    set((state) => {
      const newMap = new Map(state.onlineUsers)
      if (status === 'offline') {
        newMap.delete(userId)
      } else {
        newMap.set(userId, status)
      }
      return { onlineUsers: newMap }
    }),

  removePresence: (userId) =>
    set((state) => {
      const newMap = new Map(state.onlineUsers)
      newMap.delete(userId)
      return { onlineUsers: newMap }
    }),

  // ── Typing ────────────────────────
  typingUsers: new Map(),

  addTypingUser: (channelId, userId) =>
    set((state) => {
      const newMap = new Map(state.typingUsers)
      const existing = newMap.get(channelId) || new Set()
      existing.add(userId)
      newMap.set(channelId, existing)
      return { typingUsers: newMap }
    }),

  removeTypingUser: (channelId, userId) =>
    set((state) => {
      const newMap = new Map(state.typingUsers)
      const existing = newMap.get(channelId)
      if (existing) {
        existing.delete(userId)
        if (existing.size === 0) newMap.delete(channelId)
        else newMap.set(channelId, existing)
      }
      return { typingUsers: newMap }
    }),

  // ── Hydration Gap ─────────────────
  isBuffering: false,
  earlyEventQueue: [],

  setBuffering: (enabled) => set({ isBuffering: enabled }),

  pushEvent: (event) =>
    set((state) => ({
      earlyEventQueue: [...state.earlyEventQueue, event],
    })),

  drainEarlyEventQueue: () => {
    const { earlyEventQueue } = get()
    // Replay each queued event into the store
    for (const event of earlyEventQueue) {
      switch (event.type) {
        case 'message:new': {
          const p = event.payload as { channelId: string; message: Message }
          get().addMessage(p.channelId, p.message)
          break
        }
        case 'presence:changed': {
          const p = event.payload as { userId: string; status: PresenceStatus }
          get().setPresence(p.userId, p.status)
          break
        }
        case 'typing:update': {
          const p = event.payload as { channelId: string; userId: string }
          get().addTypingUser(p.channelId, p.userId)
          break
        }
        case 'server:member-joined': {
          // Members are lazy-loaded, but we can update server data
          break
        }
        case 'channel:created': {
          const p = event.payload as { serverId: string; channel: ServerWithChannels['channels'][0] }
          get().addChannel(p.serverId, p.channel)
          break
        }
        case 'channel:deleted': {
          const p = event.payload as { serverId: string; channelId: string }
          get().removeChannel(p.serverId, p.channelId)
          break
        }
      }
    }
    set({ earlyEventQueue: [], isBuffering: false })
  },
}))
