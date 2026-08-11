import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import type { RigSessionSummary } from "~/rig/useRigSessions";

type Props = {
  /** `null` while the initial list fetch hasn't resolved — see
   * useRigSessions. The menu still opens in that state (there's always at
   * least "New session" to offer) but shows a loading label instead of a
   * date, and disables "New session" until there's something to compare
   * against (avoids a double-create racing RigLivePanel's own
   * auto-create-the-first-one effect). */
  sessions: RigSessionSummary[] | null;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
};

/** "Aug 6, 2:14 PM" — cheap and always available (createdAt is the only
 * thing every session has, including one with no messages yet), per the
 * session picker's design decision to label by start time rather than a
 * first-message snippet or a user-editable title. */
function formatSessionLabel(createdAt: string): string {
  return new Date(createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const menuItemClassName =
  "block w-full rounded-[10px] px-3 py-2 text-left text-[12.5px] data-focus:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] data-focus:outline-none";

/**
 * The Rig panel's session picker — which RigSession for this (user, work)
 * is currently live, with every other one a reader can switch back to, and
 * a way to start a fresh one. Headless UI's Menu rather than a hand-rolled
 * dropdown: keyboard nav (arrows/Home/End/Escape/typeahead), focus
 * trapping, and click-outside-to-close all come for free instead of being
 * re-debugged here.
 */
export function RigSessionMenu({ sessions, activeSessionId, onSelect, onNewSession }: Props) {
  const active = sessions?.find((session) => session.id === activeSessionId) ?? null;
  const buttonLabel = active ? formatSessionLabel(active.createdAt) : "Sessions";

  return (
    <Menu as="div" className="relative">
      <MenuButton className="btn btn-secondary text-[12px]">
        {buttonLabel}
        <span aria-hidden="true" className="ml-1 opacity-60">
          ▾
        </span>
      </MenuButton>
      <MenuItems
        anchor="bottom start"
        className="elev-md z-30 mt-1 w-56 rounded-md border border-divider bg-surface p-1 [--anchor-gap:6px] focus:outline-none"
      >
        <MenuItem>
          <button type="button" className={menuItemClassName} disabled={!sessions} onClick={onNewSession}>
            <span className="text-[var(--color-accent)]">New session</span>
          </button>
        </MenuItem>
        {sessions === null && <div className="px-3 py-2 text-[12px] opacity-50">Loading…</div>}
        {sessions !== null && sessions.length > 0 && <div className="my-1 border-t border-divider" />}
        {sessions?.map((session) => (
          <MenuItem key={session.id}>
            <button type="button" className={menuItemClassName} onClick={() => onSelect(session.id)}>
              {formatSessionLabel(session.createdAt)}
              {session.id === activeSessionId && (
                <span aria-hidden="true" className="float-right opacity-60">
                  ✓
                </span>
              )}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}
