import type { Citation, ClaimField, Vendor } from "./types.js";
import { decodePunycodeLabels, foldConfusables } from "./unicode.js";

/** Lowercase, strip a trailing dot and a leading `www.`. No IDN resolution yet. */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/** The last two labels, e.g. "mail.acme-industrial.co.uk" -> "co.uk" is imperfect by design. */
export function registrablePart(domain: string): string {
  const labels = normalizeDomain(domain).split(".");
  return labels.slice(-2).join(".");
}

export function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, i) => i);

  for (let i = 1; i < rows; i++) {
    const current = new Array<number>(cols);
    current[0] = i;
    for (let j = 1; j < cols; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current[j] = Math.min(substitution, deletion, insertion);
    }
    previous = current;
  }

  return previous[cols - 1] ?? Math.max(a.length, b.length);
}

export type DomainVerdict = "match" | "lookalike" | "mismatch";

/**
 * Compare the domain a change request came from against the vendor master.
 * "lookalike" is the fraud case: acme-industrial.com vs acme-industria1.com.
 */
export function domainVerdict(senderDomain: string, registeredDomain: string): DomainVerdict {
  const sender = registrablePart(senderDomain);
  const registered = registrablePart(registeredDomain);

  // Equality is decided on the ASCII form. Folding first would accept a spoof: a
  // Cyrillic "а" that renders as "a" is a different domain, not the same one.
  if (sender === registered) return "match";

  const senderFolded = registrablePart(foldConfusables(decodePunycodeLabels(sender)));
  const registeredFolded = registrablePart(foldConfusables(decodePunycodeLabels(registered)));

  if (senderFolded === registeredFolded) return "lookalike";

  const withoutHyphens = (value: string) => value.replace(/-/g, "");
  if (withoutHyphens(senderFolded) === withoutHyphens(registeredFolded)) return "lookalike";

  // Same registrable label but a different TLD still counts as a mismatch, not a lookalike.
  const [senderName, senderTld] = senderFolded.split(".");
  const [registeredName, registeredTld] = registeredFolded.split(".");
  if (senderTld !== registeredTld) return "mismatch";
  if (senderName !== undefined && registeredName !== undefined) {
    const distance = levenshtein(senderName, registeredName);
    if (distance >= 1 && distance <= 2) return "lookalike";
  }

  return "mismatch";
}

/** A citation is valid only if the quoted text really sits at the claimed offset. */
export function citationIsVerbatim(rawBody: string, citation: Citation): boolean {
  if (citation.start < 0 || citation.end <= citation.start) return false;
  if (citation.end > rawBody.length) return false;
  return rawBody.slice(citation.start, citation.end) === citation.quote;
}

const digitsOnly = (value: string): string => value.replace(/[^\d+]/g, "");

/**
 * A callback number is trusted only when it matches the number already on file.
 * A number supplied *by the email* is never a trust anchor, no matter how it is worded.
 */
export function callbackIsTrusted(claimed: string, vendor: Vendor): boolean {
  return digitsOnly(claimed) === digitsOnly(vendor.phoneOnFile);
}

/** Milliseconds remaining before the cooling-off period ends. Zero means elapsed. */
export function coolingOffRemaining(
  receivedAt: number,
  now: number,
  coolingOffHours: number,
): number {
  const eligibleAt = receivedAt + coolingOffHours * 60 * 60 * 1000;
  return Math.max(0, eligibleAt - now);
}

/** True when the vendor changed bank details recently — a known fraud amplifier. */
export function changedRecently(vendor: Vendor, now: number, windowDays: number): boolean {
  if (vendor.lastBankChangeAt === null) return false;
  return now - vendor.lastBankChangeAt < windowDays * 24 * 60 * 60 * 1000;
}

/**
 * A claim is only useful if the quoted value is structurally complete.
 * A truncated IBAN is worse than no IBAN: it looks authoritative and is unusable.
 */
export function isWellFormedValue(field: ClaimField, value: string): boolean {
  switch (field) {
    case "iban": {
      const compact = value.replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
      return ibanChecksumValid(compact);
    }
    case "callbackPhone": {
      const digits = value.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15;
    }
    case "bankName":
      return value.trim().length >= 2;
    default:
      return false;
  }
}

const IBAN_CANDIDATE = /[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,6}(?: ?[A-Z0-9]{1,3})?/gi;
const PHONE_CANDIDATE = /\+?\d[\d\s()-]{7,}\d/g;

/**
 * Find a well-formed value *inside* a cited span.
 *
 * Models often quote the label with the value ("New IBAN: DE89 ..."). The span is
 * still verbatim, so we keep the trust property and take the token inside it.
 * The returned offset is relative to `text`, so the caller can recompute the
 * citation against the original body.
 */
export function extractWellFormed(
  field: ClaimField,
  text: string,
): { readonly value: string; readonly offset: number } | null {
  if (field === "bankName") {
    const value = text.trim();
    if (!isWellFormedValue(field, value)) return null;
    return { value, offset: text.indexOf(value) };
  }

  const pattern = field === "iban" ? IBAN_CANDIDATE : PHONE_CANDIDATE;
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (isWellFormedValue(field, match[0])) {
      return { value: match[0], offset: match.index ?? 0 };
    }
  }
  return null;
}

/** ISO 13616 mod-97 check. Catches truncated, transposed, and invented IBANs. */
export function ibanChecksumValid(compact: string): boolean {
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const numeric =
      character >= "A" && character <= "Z" ? String(character.charCodeAt(0) - 55) : character;
    if (numeric < "0" || numeric > "9") return false;
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}
