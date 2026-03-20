import { createTRPCReact, httpBatchLink } from '@trpc/react-query'
import type { AppRouter } from '../../../server/src/trpc/index'

export const trpc = createTRPCReact<AppRouter>()

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: 'http://localhost:3001/trpc',
      headers() {
        const token = localStorage.getItem('mingle-token')
        return token ? { Authorization: `Bearer ${token}` } : {}
      },
    }),
  ],
})
