import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import superjson from 'superjson';
import type { AppRouter } from '@split-wise/api/src/trpc/app.router.js';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/trpc',
      transformer: superjson,
    }),
  ],
});
