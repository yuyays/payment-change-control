import type { ChangeRequest, Vendor } from "@pcc/domain";
import { ChangeRequestDO } from "./ChangeRequestDO.js";
import { EmlParseError, parseEml } from "./email/parse-eml.js";
import { createExtractor, ExtractionError } from "./extraction/index.js";

export { ChangeRequestDO };

export interface Env {
  readonly CHANGE_REQUEST: DurableObjectNamespace<ChangeRequestDO>;
  /** Set to use a real model. Without it, the offline regex extractor runs. */
  readonly EXTRACTION_API_KEY?: string;
  readonly EXTRACTION_BASE_URL?: string;
  readonly EXTRACTION_MODEL?: string;
  /** Fault injection for the demo: "compromised-schema" | "compromised-fabricated". */
  readonly EXTRACTION_MODE?: string;
  /** Demo only: lets the client backdate `receivedAt` so cooling-off can be shown as elapsed. */
  readonly DEMO_MODE?: string;
  /** Test hook: override the cooling-off period in seconds. Absent means 48 hours. */
  readonly COOLING_OFF_SECONDS?: string;
}

interface EmailInput {
  readonly rawBody: string;
  readonly fromAddress: string;
  readonly replyTo?: string | null;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const normaliseAmount = (
  value: { currency: string; minor: number } | undefined,
): { currency: string; minor: number } | undefined => {
  if (value === undefined) return undefined;
  const currency = value.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return undefined;
  if (!Number.isFinite(value.minor) || value.minor < 0) return undefined;
  return { currency, minor: Math.round(value.minor) };
};

const failure = (error: unknown): Response => {
  if (error instanceof ExtractionError || error instanceof EmlParseError) {
    return json({ error: error.code, message: error.message }, 422);
  }
  return json({ error: "internal" }, 500);
};

const resolveEmail = (body: { email?: EmailInput; eml?: string }): EmailInput => {
  if (typeof body.eml === "string" && body.eml.trim() !== "") {
    const parsed = parseEml(body.eml);
    return {
      rawBody: parsed.rawBody,
      fromAddress: parsed.fromAddress,
      replyTo: parsed.replyTo,
    };
  }
  if (body.email !== undefined) return body.email;
  throw new EmlParseError("no_headers", "Provide either an `email` object or an `eml` string.");
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "payment-change-control" });
    }

    const match = /^\/api\/requests\/([A-Za-z0-9_-]+)\/(intake|approve|state|extract|replay)$/.exec(
      url.pathname,
    );
    if (match === null) return json({ error: "not_found" }, 404);

    const id = match[1];
    const action = match[2];
    if (id === undefined || action === undefined) return json({ error: "not_found" }, 404);

    if (action === "extract") {
      const body = await request.json<{ email: EmailInput }>();
      const extractor = createExtractor(env);
      try {
        const outcome = await extractor.extract({
          rawBody: body.email.rawBody,
          fromAddress: body.email.fromAddress,
          replyTo: body.email.replyTo ?? null,
        });
        return json({
          provider: outcome.provider,
          extraction: outcome.extraction,
          dropped: outcome.dropped,
        });
      } catch (error) {
        return failure(error);
      }
    }

    if (action === "intake") {
      const body = await request.json<{
        vendor: Vendor;
        email?: EmailInput;
        eml?: string;
        receivedAt?: number;
        amount?: { currency: string; minor: number };
      }>();
      const extractor = createExtractor(env);

      let email: EmailInput;
      try {
        email = resolveEmail(body);
      } catch (error) {
        return failure(error);
      }

      let extracted;
      try {
        extracted = await extractor.extract({
          rawBody: email.rawBody,
          fromAddress: email.fromAddress,
          replyTo: email.replyTo ?? null,
        });
      } catch (error) {
        return failure(error);
      }

      const amount = normaliseAmount(body.amount);

      const changeRequest: ChangeRequest = {
        id,
        vendorId: body.vendor.id,
        receivedAt:
          env.DEMO_MODE === "1" && typeof body.receivedAt === "number"
            ? body.receivedAt
            : Date.now(),
        rawBody: email.rawBody,
        extraction: extracted.extraction,
        ...(amount === undefined ? {} : { amount }),
      };

      const stub = env.CHANGE_REQUEST.get(env.CHANGE_REQUEST.idFromName(id));
      const response = await stub.fetch(
        new Request("https://do/intake", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request: changeRequest, vendor: body.vendor }),
        }),
      );

      const result = await response.json<Record<string, unknown>>();
      return json(
        { ...result, provider: extracted.provider, dropped: extracted.dropped },
        response.status,
      );
    }

    const stub = env.CHANGE_REQUEST.get(env.CHANGE_REQUEST.idFromName(id));
    const init: RequestInit =
      request.method === "GET"
        ? { method: "GET", headers: request.headers }
        : { method: request.method, headers: request.headers, body: await request.text() };

    return stub.fetch(new Request(`https://do/${action}`, init));
  },
};
