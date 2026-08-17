import styles from "./RigMemoryActivity.module.css";

type Props = {
  action: "read" | "write";
  /** Full path under the memory store's mount point, e.g.
   * `/mnt/memory/reader-preferences/cameron.md` — see
   * `BetaManagedAgentsMemoryStoreResource.mount_path` in the SDK's
   * `resources/beta/sessions/resources.d.ts`. Only the basename (minus
   * extension) is shown; the mount path itself is plumbing, not something
   * a reader needs to see. */
  path: string;
  preview?: string;
  status?: "pending" | "success" | "error";
};

function labelFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^./]+$/, "").replace(/[-_]/g, " ");
}

/**
 * Speculative: there is no `memory.read` / `memory.write` event type in the
 * Managed Agents API (checked the full `BetaManagedAgentsSessionEvent`
 * union in events.d.ts — nothing memory-shaped in it). A memory store
 * attaches to a session as a resource, mounted into the container
 * filesystem at `mount_path`; the only way memory work would ever show up
 * on the event stream is as an ordinary `agent.tool_use` (`read`/`edit`/
 * `bash`) whose path happens to fall under that mount. This component is
 * that specialization — a caller recognizes the path prefix and renders
 * this instead of a generic `RigToolUsage` — built ahead of any session
 * actually having a memory store attached (build plan M5, a later
 * milestone; see app/rig/__fixtures__/referenceSessionEvents.ts's
 * `memoryTurnEvents` for the illustrative event shape this was built
 * against). Re-validate the moment a real one is observable.
 */
export function RigMemoryActivity({
  action,
  path,
  preview,
  status = "success",
}: Props) {
  const verb = action === "read" ? "Recalled" : "Remembered";
  const label = labelFromPath(path);

  return (
    <div className={["py-1", styles.wrapper].join(" ")}>
      <span className={styles.dot} />
      <div className={styles.firstLine}>
        <span className={styles.verb}>
          {status === "pending"
            ? `${action === "read" ? "Recalling" : "Remembering"}…`
            : `${verb} `}
        </span>
        {status !== "pending" && <span className={styles.label}>{label}</span>}
      </div>
      {preview && status === "success" && (
        <div className={styles.preview}>{preview}</div>
      )}
    </div>
  );
}
