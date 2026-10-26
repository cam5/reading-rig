// `?redirectTo=` round-trips through a real magic-link email (auth.login's
// action copies it into the verify link; auth.verify redirects to it right
// after signing someone in). Left unchecked, that's an open redirect with
// the best possible phishing lure: an attacker submits a victim's address
// with redirectTo=https://evil.example, and *this app* mails them a
// genuine sign-in link that lands them on the attacker's page, freshly
// authenticated and with every reason to trust what's in front of them.
//
// Only same-origin relative paths survive. `//evil.example` and
// `/\evil.example` are protocol-relative to browsers (WHATWG URL parsing
// treats `\` like `/`), and tabs/newlines are silently stripped by the
// same parser — so `/\t/evil.example` becomes `//evil.example` after the
// fact. All three are rejected up front; the final `new URL` origin check
// is the backstop for anything those string checks didn't anticipate.
const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";

export function safeRedirect(
  to: FormDataEntryValue | string | null | undefined,
  fallback = "/",
): string {
  if (typeof to !== "string") return fallback;
  if (!to.startsWith("/") || to.startsWith("//")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(to)) return fallback;

  try {
    if (new URL(to, PLACEHOLDER_ORIGIN).origin !== PLACEHOLDER_ORIGIN) {
      return fallback;
    }
  } catch {
    return fallback;
  }
  return to;
}
