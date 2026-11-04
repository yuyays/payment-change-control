import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.js";
import { getState, seedEml, type RequestState } from "@/lib/api.js";
import { DEMO_REQUESTS, DEMO_VENDOR, seedAll } from "@/lib/demo.js";
import { formatMoney } from "@/lib/money.js";

export const Route = createFileRoute("/")({
  component: IndexRoute,
});

interface Row {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly state: RequestState | null;
}

const statusStyle: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  blocked: "bg-red-100 text-red-800",
  cooling_off: "bg-amber-100 text-amber-800",
  ready_for_review: "bg-sky-100 text-sky-800",
  unknown: "bg-stone-100 text-stone-600",
};

const label = (state: RequestState | null): string => {
  if (state === null) return "not loaded";
  if (state.status === "approved") return "approved";
  if (state.evaluation.outcome === "reject") return "rejected";
  const blocking = state.evaluation.reasons.filter((r) => r.blocking).length;
  if (blocking > 0) return "blocked";
  return state.status === "cooling_off" ? "cooling off" : "ready for review";
};

function IndexRoute() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const statesQuery = useQuery({
    queryKey: ["states"],
    queryFn: async (): Promise<ReadonlyArray<Row>> => {
      const rows = await Promise.all(
        DEMO_REQUESTS.map(async (demo) => {
          try {
            const result = await getState(demo.id);
            return { id: demo.id, title: demo.title, subtitle: demo.subtitle, state: result.state };
          } catch {
            return { id: demo.id, title: demo.title, subtitle: demo.subtitle, state: null };
          }
        }),
      );
      // Largest exposure first; unknown amounts last.
      return [...rows].sort(
        (a, b) => (b.state?.request.amount?.minor ?? -1) - (a.state?.request.amount?.minor ?? -1),
      );
    },
    refetchInterval: 4000,
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const id = `import-${Date.now()}`;
      await seedEml(id, DEMO_VENDOR, text);
      return id;
    },
    onMutate: () => setImportError(null),
    onSuccess: (id) => {
      void navigate({ to: "/requests/$id", params: { id } });
    },
    onError: (error: Error) => setImportError(error.message),
  });

  const seedMutation = useMutation({
    mutationFn: seedAll,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["states"] }),
  });

  const rows = statesQuery.data ?? [];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#ecfeff,_transparent_34rem),linear-gradient(135deg,_#fafaf9,_#f5f5f4)] px-6 py-10 text-stone-950">
      <section className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-700">
            Payment change control
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold tracking-tight">
            The model reads the email. Code decides. A human approves.
          </h1>
          <p className="max-w-2xl text-lg text-stone-600">
            Every decision has exactly one owner. There is no code path from a model output to a
            changed bank account.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
            {seedMutation.isPending ? "Loading…" : "Load demo data"}
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? "Parsing…" : "Import .eml"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".eml,message/rfc822,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) importMutation.mutate(file);
              event.target.value = "";
            }}
          />
          <span className="text-sm text-stone-500">
            {importError !== null
              ? importError
              : seedMutation.isError
                ? "Could not reach the API. Is the worker running on :8787?"
                : "Seeds six requests, then refreshes every few seconds."}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((row) => {
            const status = label(row.state);
            return (
              <Link key={row.id} to="/requests/$id" params={{ id: row.id }} className="block">
                <Card className="h-full transition-colors hover:border-stone-400">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-xl">{row.title}</CardTitle>
                        <CardDescription className="mt-1">{row.subtitle}</CardDescription>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                          statusStyle[status] ?? statusStyle["unknown"]
                        }`}
                      >
                        {status}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 text-sm text-stone-600">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-stone-400">{row.id}</span>
                      <span className="font-medium text-stone-800">
                        {row.state?.request.amount === undefined
                          ? "—"
                          : formatMoney(row.state.request.amount)}
                      </span>
                      <span>
                        {row.state === null
                          ? "—"
                          : `${row.state.evaluation.reasons.length} finding${
                              row.state.evaluation.reasons.length === 1 ? "" : "s"
                            }`}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
