/**
 * A deliberately small RFC 822 reader.
 *
 * Scope: what an accounts-payable inbox actually forwards — plain text, base64,
 * quoted-printable, multipart/alternative, multipart/mixed, and HTML-only mail.
 * It is not a full MIME implementation and does not attempt charsets beyond UTF-8.
 *
 * The output body is the *decoded* string. Citations are anchored to it, so the
 * model and the validator must always see this exact value.
 */

export interface ParsedEmail {
  readonly fromAddress: string;
  readonly replyTo: string | null;
  readonly subject: string;
  readonly rawBody: string;
}

export type EmlErrorCode = "no_headers" | "no_from" | "no_body" | "unsupported_encoding";

export class EmlParseError extends Error {
  readonly _tag = "EmlParseError";
  constructor(
    readonly code: EmlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EmlParseError";
  }
}

interface Part {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const HEADER_END = /\r?\n\r?\n/;

function unfold(source: string): string {
  return source.replace(/\r?\n[ \t]+/g, " ");
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of unfold(block).split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    headers[key] = line.slice(colon + 1).trim();
  }
  return headers;
}

function splitPart(source: string): Part {
  const match = HEADER_END.exec(source);
  if (match === null) {
    return { headers: {}, body: source };
  }
  return {
    headers: parseHeaders(source.slice(0, match.index)),
    body: source.slice(match.index + match[0].length),
  };
}

function decodeBase64(value: string): string {
  const clean = value.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function decodeQuotedPrintable(value: string): string {
  const withoutSoftBreaks = value.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < withoutSoftBreaks.length; index += 1) {
    const character = withoutSoftBreaks[index];
    if (character === "=" && index + 2 < withoutSoftBreaks.length) {
      const hex = withoutSoftBreaks.slice(index + 1, index + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        index += 2;
        continue;
      }
    }
    bytes.push(character?.charCodeAt(0) ?? 0);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function decodeBody(part: Part): string {
  const encoding = (part.headers["content-transfer-encoding"] ?? "").toLowerCase();
  if (encoding === "base64") return decodeBase64(part.body);
  if (encoding === "quoted-printable") return decodeQuotedPrintable(part.body);
  if (encoding === "") return part.body;
  throw new EmlParseError("unsupported_encoding", `Unsupported encoding: ${encoding}`);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary="?([^";]+)"?/i.exec(contentType);
  return match?.[1] ?? null;
}

/** Walk the MIME tree and return the best text body. */
function extractText(part: Part): string | null {
  const contentType = (part.headers["content-type"] ?? "text/plain").toLowerCase();

  if (contentType.startsWith("multipart/")) {
    const boundary = boundaryOf(part.headers["content-type"] ?? "");
    if (boundary === null) return null;

    const segments = part.body.split(`--${boundary}`);
    const children = segments
      .map((segment) => segment.replace(/^\r?\n/, ""))
      .filter((segment) => segment.trim() !== "" && !segment.startsWith("--"))
      .map(splitPart);

    let htmlFallback: string | null = null;
    for (const child of children) {
      const text = extractText(child);
      if (text === null) continue;
      const childType = (child.headers["content-type"] ?? "text/plain").toLowerCase();
      if (childType.startsWith("text/html")) {
        htmlFallback ??= text;
        continue;
      }
      if (text.trim() !== "") return text;
    }
    return htmlFallback;
  }

  if (contentType.startsWith("text/html")) {
    return stripHtml(decodeBody(part));
  }

  if (contentType.startsWith("text/plain")) {
    return decodeBody(part);
  }

  return null;
}

function addressOf(value: string | undefined): string | null {
  if (value === undefined) return null;
  const angled = /<([^>]+)>/.exec(value);
  const candidate = (angled?.[1] ?? value).trim();
  return candidate.includes("@") ? candidate.toLowerCase() : null;
}

export function parseEml(source: string): ParsedEmail {
  const normalised = source.replace(/\r\n/g, "\n");
  if (!normalised.includes(":")) {
    throw new EmlParseError("no_headers", "This does not look like an email: no headers found.");
  }

  const root = splitPart(normalised);
  const fromAddress = addressOf(root.headers["from"]);
  if (fromAddress === null) {
    throw new EmlParseError("no_from", "The email has no usable From address.");
  }

  const body = extractText(root);
  if (body === null || body.trim() === "") {
    throw new EmlParseError("no_body", "The email has no readable text body.");
  }

  return {
    fromAddress,
    replyTo: addressOf(root.headers["reply-to"]),
    subject: root.headers["subject"] ?? "",
    rawBody: body,
  };
}
