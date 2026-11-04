import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.js";
import { usersQueryOptions } from "@/lib/users.js";

export const Route = createFileRoute("/")({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(usersQueryOptions);
  },
  component: IndexRoute,
});

function IndexRoute() {
  const usersQuery = useQuery(usersQueryOptions);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#ecfeff,_transparent_34rem),linear-gradient(135deg,_#fafaf9,_#f5f5f4)] px-6 py-10 text-stone-950">
      <section className="mx-auto flex max-w-4xl flex-col gap-8">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-700">
            Effect starter
          </p>
          <h1 className="max-w-2xl text-5xl font-semibold tracking-tight">
            React client, Effect Platform API, shared contracts.
          </h1>
          <p className="max-w-2xl text-lg text-stone-600">
            TanStack Query calls an Effect HttpApiClient generated from the same API contract the
            server implements.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Read-only example backed by Drizzle and PostgreSQL.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={() => void usersQuery.refetch()} disabled={usersQuery.isFetching}>
              {usersQuery.isFetching ? "Loading..." : "Refetch"}
            </Button>

            {usersQuery.isError ? (
              <p className="text-sm text-red-700">Could not load users. Is the API running?</p>
            ) : usersQuery.data?.length ? (
              <ul className="space-y-2">
                {usersQuery.data.map((user) => (
                  <li key={user.id} className="rounded-md border border-stone-200 bg-white p-3">
                    {user.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md border border-dashed border-stone-300 bg-white/70 p-4 text-sm text-stone-600">
                No users yet. The starter intentionally ships without seed data.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
