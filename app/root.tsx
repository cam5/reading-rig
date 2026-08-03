import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
// `?url` gets Vite to fingerprint these the same way it does when they're
// referenced from fonts.css's own `url(...)` — so the href below always
// matches the actual hashed asset the browser will request, not a path
// that happens to work in dev and 404s once the filename is content-hashed
// at build time.
import figtreeLatin400Woff2 from "@fontsource/figtree/files/figtree-latin-400-normal.woff2?url";
import ebGaramondLatin400Woff2 from "@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2?url";

// Caprasimo (display), Figtree (interface) and EB Garamond (the book
// itself, via --font-reading) are self-hosted and loaded via app.css's own
// @import of styles/fonts.css — one font-loading path, not two.
//
// Preloading the latin-400 (the common case: ASCII body text, weight 400)
// cut of Figtree and EB Garamond specifically — not every weight/subset,
// and not Caprasimo — is the counterpart to fonts.css's `font-display:
// optional` (see #89): `optional` only gets to use the real face
// instead of the fallback if it's already available within a very short
// block period, so without a preload hint here, the font-face src wouldn't
// even start fetching until layout discovers the CSS needs it — chronically
// missing that window. EB Garamond's latin-400 face covers the reading
// column, by far the largest and most CLS-sensitive content on the page;
// Figtree's covers the interface chrome that's visible on every route,
// including this header. Not preloading latin-ext (accented/non-Latin
// text — rare in these fixtures) or Caprasimo (a handful of short display
// strings, already glyph-subsetted to almost nothing) keeps this from
// competing with the two that actually matter for bandwidth on a cold
// load.
export const links: Route.LinksFunction = () => [
  { rel: "preload", as: "font", type: "font/woff2", href: figtreeLatin400Woff2, crossOrigin: "anonymous" },
  { rel: "preload", as: "font", type: "font/woff2", href: ebGaramondLatin400Woff2, crossOrigin: "anonymous" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      {/* Deliberately not Caprasimo: "Oops!"/"404"/"Error" aren't part of the
          closed DISPLAY_STRINGS set Caprasimo is subsetted to (see
          domain/typography/displayStrings.ts) — folding them in would mean
          re-subsetting Caprasimo for a screen almost nobody sees. Reset to
          the body font instead of adding these strings to the enum. */}
      <h1 style={{ fontFamily: "var(--font-body)" }}>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
