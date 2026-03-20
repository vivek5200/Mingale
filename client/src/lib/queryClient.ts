import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,       // 30s — don't refetch on every click
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
