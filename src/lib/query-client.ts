import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      // Mutations are not retried: replaying an approve or cancel is worse
      // than surfacing the failure to the person who triggered it.
      mutations: { retry: false },
    },
  });
}
