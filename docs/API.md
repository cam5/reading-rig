# The `/api/v1` surface

Plain JSON for a client that is not a browser. The page routes (`/`,
`/read/*`, `/commonplace`) answer `.data` requests in React Router's
single-fetch turbo-stream format, which a native app cannot read and should not
have to. Each `/api/v1` route returns the same data as its page counterpart,
through the same domain-layer function, as ordinary JSON.

This is a guide, not the contract. Exact request and response shapes live in
[`openapi/api-v1.json`](../openapi/api-v1.json), generated from the zod schemas
in `app/domain/api/schemas/`. Where this file and the code disagree, the code
is right.

## Authentication

Every route except `openapi.json` calls `requireApiUser()`
(`app/user.server.ts`), which tries, in order:

1. An `Authorization: Bearer <token>` header.
2. The `__rig_session` cookie a magic-link sign-in sets — the web app's own
   client-side fetches use this.
3. Outside production and staging-qa only, the oldest user in the database.
   This is what lets local dev, CI and PR environments work with no credential
   at all.

If none resolves, the answer is `401` with `{ "error": "Unauthorized" }` — never
a redirect to the login page, which is what `requireUser()` does for the page
routes.

A bearer token that is unknown or revoked is ignored rather than rejected on
its own: the request falls through to the cookie and then the fallback. In
production that ends in the same 401. Locally it ends at the seeded user, so a
mistyped token can look as though it worked — check `userId` in
`GET /api/v1/home` if in doubt.

### Bearer tokens

There is no sign-in flow that issues one. They are minted from the command
line, for a user who already exists:

```bash
npm run api-token create <email> [label]
npm run api-token list <email>
npm run api-token revoke <email> <tokenId>
```

`create` prints the token once. Only its sha256 hash is stored, so it cannot be
shown again. Tokens start with `rig_`. `list` shows each token's id, label,
creation time, and when it was last used or revoked. `revoke` is a quiet no-op
for an id that does not exist or belongs to someone else.

The script talks to whatever database `DATABASE_URL` names, so a token for a
deployed environment has to be minted against that environment's database.

```bash
curl -H "Authorization: Bearer rig_…" "$BASE_URL/api/v1/home"
```

## Errors

| Status | Body                                                              | When                                                                                                                                         |
| ------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | JSON: `{ "error": "Bad request", "issues": [{ path, message }] }` | The request failed its zod schema (`parseOrBadRequest` in `app/domain/api/errors.server.ts`).                                                |
| 400    | plain text                                                        | A business rule in `handleReadAction.server.ts` — a note with no body, an unknown intent.                                                    |
| 401    | JSON: `{ "error": "Unauthorized" }`                               | No credential resolved.                                                                                                                      |
| 404    | plain text                                                        | The work, entry or Rig session does not exist, or is not yours. The two cases are deliberately indistinguishable.                            |
| 503    | plain text                                                        | A Rig route that needs Anthropic, in an environment with no `ANTHROPIC_API_KEY`.                                                             |
| 500    | —                                                                 | A response failed its own schema. Each route `.parse()`s what it is about to return; a mismatch is a bug in the route, and is left to throw. |

A client should tolerate a non-JSON error body. The plain-text cases predate
this layer, are shared with the page routes, and are not modelled in the
OpenAPI document.

## Routes

| Path                           | Methods       | Purpose                                                                                                                         | Page counterpart          |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `/api/v1/home`                 | `GET`         | The signed-in user's shelf, and their `userId`.                                                                                 | `/`                       |
| `/api/v1/read/*`               | `GET`         | A work's read-page data: outline, structural paragraphs, the first content window, bookmark, progress. `?section=` opens there. | `/read/*` loader          |
| `/api/v1/read/*`               | `POST`        | Highlight, annotate or bookmark. See [Writes](#writes).                                                                         | `/read/*` action          |
| `/api/v1/read-content`         | `GET`         | A window of paragraphs by global ordinal: `?work=&min=&max=`, both ends inclusive.                                              | none — a reader sidecar   |
| `/api/v1/mention-suggestions`  | `GET`         | Candidates for the composer's "@" mentions: `?work=&q=`. An empty `q` means "closest to my bookmark".                           | none — a composer sidecar |
| `/api/v1/commonplace`          | `GET`         | The commonplace book. `?entry=` selects one entry and expands it.                                                               | `/commonplace`            |
| `/api/v1/commonplace/:entryId` | `GET`         | One entry.                                                                                                                      | `/commonplace/:entryId`   |
| `/api/v1/rig/*`                | `GET`         | Open the Rig's session stream. Server-Sent Events, not JSON.                                                                    | none                      |
| `/api/v1/rig/*`                | `POST`        | Send a message into the session.                                                                                                | none                      |
| `/api/v1/rig-sessions/*`       | `GET`, `POST` | List a work's Rig sessions, or start a new one.                                                                                 | none                      |
| `/api/v1/openapi.json`         | `GET`         | The OpenAPI document, built live. No authentication.                                                                            | none                      |

`*` is the work id. The four sidecars — `read-content`, `mention-suggestions`,
`rig` and `rig-sessions` — are not mirrors of a page: they are the routes the
web reader itself fetches from as you scroll, type and talk. A native client
uses the same ones.

Every route that names a work checks that you own it or hold a `WorkGrant` for
it before returning anything.

`mention-suggestions` is called on nearly every keystroke, so a failed search
degrades to `{ "suggestions": [] }` instead of an error.

### Why work ids are splats

A work id is a slash-shaped slug, such as `karl-marx/capital-volume-i`,
following Standard Ebooks' own multi-segment URLs. (An ingested work's id also
carries an edition hash: `jane-austen/pride-and-prejudice@377c8b796227`.) A
single dynamic segment cannot match that, so these routes are splats and the id
is everything after the prefix. The web app puts the id into the path as it
is, slashes and all, and encodes it only where it travels as a query
parameter (`?work=`).

Two consequences:

- A splat has to be the trailing segment. That is why the paragraph window is
  `/api/v1/read-content?work=…` and not nested under `/api/v1/read/*`, and why
  the Rig routes are `/api/v1/rig/*` and not `/api/v1/read/*/rig`.
- OpenAPI 3.0 cannot express a splat. The document writes `{workId}`, which a
  code generator will treat as a single segment unless told otherwise.

### Writes

`POST /api/v1/read/*` is the only way a highlight, note or bookmark is made.
The Rig is read-only, and there is no second write path.

The body is form-encoded, not JSON — the same `FormData` the web app posts. An
`intent` field selects one of four shapes:

| `intent`         | Fields                                                   |
| ---------------- | -------------------------------------------------------- |
| `highlight`      | `spans`                                                  |
| `highlight-note` | `spans`, `body`, optional `excerpt`                      |
| `note`           | `paragraphId`, `body`, optional `highlightId`, `excerpt` |
| `bookmark`       | `paragraphId`                                            |

`spans` is a single field holding a JSON-encoded array of
`{ paragraphId, start, end }`, with at least one element. Success is
`{ "ok": true }`.

The schema checks shape only. The rules themselves — a note needs a body, a
span has to resolve to a real paragraph — stay in `handleReadAction.server.ts`,
shared with the page action, and fail with the plain-text errors above.

### The Rig: a stream and a sidecar

`GET /api/v1/rig/*` always returns `text/event-stream`. Each frame is a
`data:` line carrying one `RigSessionEvent` (`app/rig/sessionSource.ts`) as
JSON, plus a `live` boolean: true for an event streamed just now, false for one
replayed from history when a session is resumed. A failure arrives as an
`event: error` frame with `{ "message": … }`, after which the stream closes.

`POST /api/v1/rig/*` takes a form field, `message`, and answers
`{ "ok": true }`. The reply does not come back in that response; it arrives on
the stream.

Both take an optional `?session=<id>`. Without it they use the most recently
created session for this user and work, creating one the first time.

Because that `GET` can never return JSON, listing and creating sessions lives
on a separate route. `GET /api/v1/rig-sessions/*` returns
`{ sessions: [{ id, createdAt }], rigUnavailableReason }`, where a null reason
means the Rig is usable here. `POST` starts a new session and returns its `id`
and `createdAt`.

The stream is not modelled in the OpenAPI document beyond its content type,
and it is left out of the smoke test: opening one needs a real Anthropic
session.

## The OpenAPI document

`app/domain/api/openapi.server.ts` builds the document from the same zod
schemas the routes validate against. It has two outlets:

- `GET /api/v1/openapi.json` serves it live, so it always matches what is
  deployed. It is unauthenticated on purpose: it describes shapes, not data,
  and a client needs it before it has a session.
- [`openapi/api-v1.json`](../openapi/api-v1.json) is the committed copy, there
  so that a contract change shows up as a diff in review.

After changing a schema in `app/domain/api/schemas/`, or the `paths` in
`openapi.server.ts`, regenerate the committed copy and commit it with the
change:

```bash
npm run generate:openapi
```

Nothing does this for you, and CI does not check that the file is current.

The iOS client depends on that file. `ios/Sources/ReadingRigKit/openapi.json`
is a symlink to it, and `swift-openapi-generator` reads it at build time, so a
regenerated file changes the Swift client on its next build.
`.github/workflows/ios.yml` runs `swift test` whenever `openapi/**` changes.
See [`ios/README.md`](../ios/README.md).

`openapi.server.ts`'s own doc comment records where the document simplifies on
purpose: schemas are inlined rather than shared, except the four read-action
variants, which are named components because the Swift generator needs `$ref`s
to build a tagged enum.

## Adding or changing a route

The pieces that have to agree, none of which is derived from another:

- the route's entry in `app/routes.ts`, and its file in `app/routes/`
- its request and response schemas in `app/domain/api/schemas/`
- its entry under `paths` in `app/domain/api/openapi.server.ts`
- the committed `openapi/api-v1.json`
- a case in `app/routes/apiV1.smoke.test.ts`, which is what catches a route
  that is registered wrongly or has lost an export — see
  [TESTING.md](./TESTING.md)
