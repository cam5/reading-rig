// Railway's deploy.healthcheckPath (railway.toml) — gates traffic cutover to
// a new instance independent of the release step (scripts/release.ts).
// Deliberately touches no DB: this only proves the server process itself is
// answering requests.
export function loader() {
  return new Response("ok", { status: 200 });
}
