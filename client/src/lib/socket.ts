import { io, Socket } from 'socket.io-client'
import { getToken } from './tokenStorage'

const SERVER_URL = 'http://localhost:3001'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    const token = getToken()
    socket = io(SERVER_URL, {
      auth: { token },
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      // Exponential backoff with jitter (prevents reconnect floods)
      randomizationFactor: 0.5,
    })
  }
  return socket
}

export function connectSocket(token: string) {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  socket = io(SERVER_URL, {
    auth: { token },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    randomizationFactor: 0.5,
  })
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
