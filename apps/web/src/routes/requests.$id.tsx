import { authorityTable } from "@pcc/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.js";
import { approve, getState, replay, type Claim, type ReplayResult } from "@/lib/api.js";
import { formatMoney } from "@/lib/money.js";

export const Route = createFileRoute("/requests/$id")({
  component: RequestRoute,
});

const ownerStyle: Record<string, string> = {
  model: "bg-violet-100 text-violet-800",
  code: "bg-sky-100 text-sky-800",
  human: "bg-emerald-100 text-emerald-800",
};

function Highlighted({
  body,
  claims,
  activeStarts,
}: {
  body: string;
  claims: ReadonlyArray<Claim>;
  activeStarts: ReadonlySet<number>;
}) {
  const ranges = claims
    .map((claim) => [claim.citation.start, claim.citation.end] as const)
    .sort((a, b) => a[0] - b[0]);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    if (start > cursor) nodes.push(body.slice(cursor, start));
    nodes.push(
      <mark
        key={key++}
        className={
          activeStarts.has(start)
            ? "rounded bg-cyan-200 px-0.5 text-stone-900 ring-1 ring-cyan-500"
            : "rounded bg-cyan-100 px-0.5 text-stone-900"
        }
      >
        {body.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  nodes.push(body.slice(cursor));

  return (
    <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-stone-800">{nodes}</pre>
  );
}

function RequestRoute() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const startedAt = useRef<number | null>(null);

  const stateQuery = useQuery({
    queryKey: ["state", id],
    queryFn: () => getState(id),
    refetchInterval: 4000,
  });

  useEffect(() => {
    const current = stateQuery.data?.state ?? null;
    if (startedAt.current === null && current !== null) startedAt.current = Date.now();
  }, [stateQuery.data]);

  const openCitation = (index: number): void => {
    setOpened((previous) => {
      if (previous.has(index)) return previous;
      const next = new Set(previous);
      next.add(index);
      return next;
    });
  };

  const approval = useMutation({
    mutationFn: ({ approverId, actor }: { approverId: string; actor: "human" | "model" }) =>
      approve(
        id,
        approverId,
        actor,
        actor === "human"
          ? {
              citationsOpened: opened.size,
              dwellMs: startedAt.current === null ? 0 : Date.now() - startedAt.current,
            }
          : undefined,
      ),
    onMutate: () => setMessage(null),
    onSuccess: () => {
      setMessage("Recorded.");
      void queryClient.invalidateQueries({ queryKey: ["state", id] });
      void queryClient.invalidateQueries({ queryKey: ["states"] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [replayNote, setReplayNote] = useState<string | null>(null);

  const replayMutation = useMutation({
    mutationFn: (mode: "stored" | "current") => replay(id, mode),
    onMutate: () => {
      setReplayNote(null);
      setReplayResult(null);
    },
    onSuccess: (result) => setReplayResult(result),
    onError: (error: Error) => setReplayNote(error.message),
  });

  const state = stateQuery.data?.state;

  if (stateQuery.isLoading) {
    return <main className="p-10 text-stone-600">Loading…</main>;
  }

  if (state === undefined || state === null) {
    return (
      <main className="p-10">
        <p className="text-stone-600">No such request.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-cyan-700 underline">
          Back to the list
        </Link>
      </main>
    );
  }

  const blocking = state.evaluation.reasons.filter((reason) => reason.blocking);
  const eligible = new Date(state.evaluation.eligibleAt);

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-10 text-stone-950">
      <section className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-sm text-cyan-700 underline">
            ← All requests
          </Link>
          <span className="font-mono text-xs text-stone-400">{state.request.id}</span>
        </div>

        <header className="space-y-1">
          <p className="text-sm uppercase tracking-[0.2em] text-stone-500">{state.vendor.name}</p>
          <h1 className="text-3xl font-semibold">
            {state.evaluation.outcome === "reject" ? "Rejected at intake" : "Pending human review"}
          </h1>
          <p className="text-sm font-medium text-stone-800">
            {state.request.amount === undefined
              ? "Amount at risk: not set"
              : `Amount at risk: ${formatMoney(state.request.amount)}`}
          </p>
          <p className="text-sm text-stone-600">
            From {state.request.extraction.fromAddress}
            {state.request.extraction.replyTo === null
              ? ""
              : ` · Reply-To ${state.request.extraction.replyTo}`}
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">The email</CardTitle>
                <CardDescription>
                  Highlighted spans passed the verbatim citation check. Nothing else is trusted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Highlighted
                  body={state.request.rawBody}
                  claims={state.evaluation.validClaims}
                  activeStarts={
                    new Set(
                      state.evaluation.validClaims
                        .filter((_, index) => opened.has(index))
                        .map((claim) => claim.citation.start),
                    )
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Claims</CardTitle>
                <CardDescription>
                  Open a citation to see where the claim came from. Opens are recorded.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {state.evaluation.validClaims.length === 0 ? (
                  <p className="text-sm text-stone-500">No claim survived validation.</p>
                ) : (
                  state.evaluation.validClaims.map((claim, index) => (
                    <div
                      key={`${claim.field}-${claim.citation.start}`}
                      className="rounded-md border border-stone-200 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-xs font-medium text-stone-800">{claim.field}</code>
                        <Button size="sm" variant="outline" onClick={() => openCitation(index)}>
                          {opened.has(index) ? "Opened" : "View evidence"}
                        </Button>
                      </div>
                      <p className="mt-1 font-mono text-xs text-stone-700">{claim.value}</p>
                      {opened.has(index) ? (
                        <p className="mt-1 text-[11px] text-stone-500">
                          source: &ldquo;{claim.citation.quote}&rdquo; @ {claim.citation.start}–
                          {claim.citation.end}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Findings</CardTitle>
                <CardDescription>
                  {state.evaluation.reasons.length === 0
                    ? "None."
                    : `${blocking.length} blocking of ${state.evaluation.reasons.length}.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {state.evaluation.reasons.length === 0 ? (
                  <p className="text-sm text-stone-500">No findings.</p>
                ) : (
                  state.evaluation.reasons.map((reason) => (
                    <div key={reason.code} className="rounded-md border border-stone-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-xs font-medium text-stone-800">{reason.code}</code>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            ownerStyle[reason.owner] ?? ownerStyle["code"]
                          }`}
                        >
                          {reason.owner}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-stone-600">{reason.detail}</p>
                      {reason.blocking ? (
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-red-600">
                          blocking
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Approval</CardTitle>
                <CardDescription>
                  Eligible from {eligible.toLocaleString()}. Two distinct humans.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => approval.mutate({ approverId: "clerk", actor: "human" })}
                    disabled={approval.isPending}
                  >
                    Approve as clerk
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => approval.mutate({ approverId: "controller", actor: "human" })}
                    disabled={approval.isPending}
                  >
                    Approve as controller
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => approval.mutate({ approverId: "claude", actor: "model" })}
                  disabled={approval.isPending}
                >
                  Try to approve as the model
                </Button>
                {message === null ? null : (
                  <p
                    className={`rounded-md p-2 text-xs ${
                      message === "Recorded."
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-red-50 text-red-800"
                    }`}
                  >
                    {message}
                  </p>
                )}
                <p className="text-xs text-stone-500">
                  Approvals recorded: {state.approvals.length}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Review evidence</CardTitle>
                <CardDescription>
                  What each approver did. Telemetry, never a decision input.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {state.evidence.length === 0 ? (
                  <p className="text-sm text-stone-500">No approvals recorded yet.</p>
                ) : (
                  <div className="space-y-2 text-xs text-stone-600">
                    <p className="text-sm text-stone-800">
                      {state.evidence.filter((item) => item.citationsOpened > 0).length} of{" "}
                      {state.evidence.length} opened a citation
                    </p>
                    <ul className="space-y-1">
                      {state.evidence.map((item) => (
                        <li key={`${item.approverId}-${item.at}`} className="font-mono">
                          {item.approverId}: {item.citationsOpened} citation
                          {item.citationsOpened === 1 ? "" : "s"} ·{" "}
                          {(item.dwellMs / 1000).toFixed(1)}s
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Replay</CardTitle>
            <CardDescription>
              Re-run the stored decision with its recorded clock, or re-extract with the current
              model and diff the claims.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => replayMutation.mutate("stored")}
                disabled={replayMutation.isPending}
              >
                Replay decision
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => replayMutation.mutate("current")}
                disabled={replayMutation.isPending}
              >
                Re-extract and diff
              </Button>
            </div>

            {replayNote === null ? null : (
              <p className="rounded-md bg-red-50 p-2 text-xs text-red-800">{replayNote}</p>
            )}

            {replayResult === null ? null : (
              <div className="space-y-2 text-sm">
                <p>
                  <span
                    className={
                      replayResult.decision.same
                        ? "font-medium text-emerald-700"
                        : "font-medium text-red-700"
                    }
                  >
                    {replayResult.decision.same ? "Identical decision" : "Decision changed"}
                  </span>
                  <span className="text-stone-500">
                    {" · clock "}
                    {new Date(replayResult.decision.evaluatedAt).toLocaleString()}
                  </span>
                </p>
                <p className="font-mono text-xs text-stone-600">
                  stored: {replayResult.decision.stored.outcome} [
                  {replayResult.decision.stored.reasons.join(", ") || "no findings"}]
                </p>
                <p className="font-mono text-xs text-stone-600">
                  replayed: {replayResult.decision.replayed.outcome} [
                  {replayResult.decision.replayed.reasons.join(", ") || "no findings"}]
                </p>

                {replayResult.claims === null ? null : (
                  <div className="space-y-1 rounded-md bg-stone-50 p-3 text-xs text-stone-700">
                    <p className="font-medium">
                      {replayResult.claims.extractor} · stored {replayResult.claims.stored} ·
                      replayed {replayResult.claims.replayed}
                    </p>
                    {replayResult.claims.diff.added.length > 0 ? (
                      <p className="text-emerald-700">
                        + {replayResult.claims.diff.added.join(", ")}
                      </p>
                    ) : null}
                    {replayResult.claims.diff.removed.length > 0 ? (
                      <p className="text-red-700">
                        − {replayResult.claims.diff.removed.join(", ")}
                      </p>
                    ) : null}
                    {replayResult.claims.diff.added.length === 0 &&
                    replayResult.claims.diff.removed.length === 0 ? (
                      <p className="text-stone-500">No claim differences.</p>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Authority</CardTitle>
            <CardDescription>
              Rendered from the same table the gate enforces, not from documentation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-stone-100">
              {authorityTable().map(([action, owner]) => (
                <li key={action} className="flex items-center justify-between py-2 text-sm">
                  <code className="text-stone-700">{action}</code>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      ownerStyle[owner] ?? ownerStyle["code"]
                    }`}
                  >
                    {owner}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Trace</CardTitle>
            <CardDescription>Append-only, from the Durable Object.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1 font-mono text-xs text-stone-600">
              {(stateQuery.data?.events ?? []).map((event) => (
                <li key={event.seq}>
                  #{event.seq} {new Date(event.at).toLocaleTimeString()} — {event.type}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
