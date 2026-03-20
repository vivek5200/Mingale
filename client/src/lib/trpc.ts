import { createTRPCReact, httpBatchLink } from '@trpc/react-query'
import type { AppRouter } from '../../../server/src/trpc/index'
import { getToken } from './tokenStorage'

export const trpc = createTRPCReact<AppRouter>()

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: 'http://localhost:3001/trpc',
      headers() {
        const token = getToken()
        return token ? { Authorization: `Bearer ${token}` } : {}
      },
    }),
  ],
})
