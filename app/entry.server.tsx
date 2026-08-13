import { PassThrough } from "node:stream";

import type {
  EntryContext,
  HandleErrorFunction,
  RouterContextProvider,
} from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";

import { canonicalRequestUrl, captureException } from "./analytics.server";
import { requireUser } from "./user.server";

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    let userAgent = request.headers.get("user-agent");

    // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
    // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
    let readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";

    // Abort the rendering stream after the `streamTimeout` so it has time to
    // flush down the rejected boundaries
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    );

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              // Clear the timeout to prevent retaining the closure and memory leak
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          pipe(body);

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError(error: unknown) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );
  });
}

/**
 * React Router's own hook for anything a loader, action, or render throws
 * that a route's `ErrorBoundary` didn't catch — replaces the framework's
 * default (`console.error` and nothing else) with the one call site that
 * turns a thrown error into a PostHog event (see `analytics.server.ts`'s
 * `captureException`). Still `console.error`s first: a misreported
 * exception shouldn't mean an unreported one too.
 *
 * `requireUser()` re-queries rather than threading a user through — nothing
 * upstream of an arbitrary throw is guaranteed to have looked one up yet,
 * and this app has exactly one, so the extra query costs nothing a real
 * failure wasn't already going to cost.
 *
 * A client disconnecting mid-request surfaces here as an aborted-signal
 * error, not a bug in this app — skipped rather than reported.
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (request.signal.aborted) return;

  console.error(error);

  requireUser()
    .then((user) =>
      captureException(error, {
        distinctId: user.id,
        currentUrl: canonicalRequestUrl(request),
      }),
    )
    .catch((requireUserError) =>
      console.warn(
        "[error-tracking] could not report exception:",
        requireUserError,
      ),
    );
};
