import { useRef } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";

type Props = {
  /** The visible digit(s), e.g. "1" — same text the source epub's
   * noteref anchor carried. */
  label: string;
  /** Sanitized footnote body HTML (sanitizeFootnoteBody) — trusted, same
   * trust model as ReadingParagraph's own paragraph.html. */
  bodyHtml: string;
};

/**
 * A footnote reference's popover — mounted via a portal into the real
 * <sup data-footnote-ref> element sanitizeHtml.ts left in the paragraph's
 * server-rendered HTML (see ReadingParagraph). That element already
 * supplies the actual superscript positioning, so this renders as a
 * plain inline span, not a second nested <sup>.
 *
 * Headless UI's Popover rather than a hand-rolled one (see
 * RigSessionMenu's own reasoning) — outside-click/Escape-to-close and
 * focus handling come for free. Click/tap already opens it via
 * PopoverButton's default behavior; the onMouseEnter/onMouseLeave pair
 * below layers in hover-to-open for desktop, guarded by the render
 * prop's `open` so entering while already open (or leaving while already
 * closed) doesn't fight the click toggle. Touch has no hover state, so
 * the panel's own close button is the only dismissal a tap gets besides
 * tapping outside.
 */
export function FootnoteMarker({ label, bodyHtml }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <Popover as="span" className="relative">
      {({ open, close }) => (
        <span
          onMouseEnter={() => {
            if (!open) buttonRef.current?.click();
          }}
          onMouseLeave={() => {
            if (open) close();
          }}
        >
          <PopoverButton
            ref={buttonRef}
            // A native <button> keeps its default border/padding/inline-block
            // box even after Tailwind's Preflight (which only resets its
            // font/color/background — see preflight.css) — left alone, that
            // extra box inflates this row's height right after
            // useVirtualizedRows already measured it without them, and the
            // ResizeObserver correction that follows visibly shifts scroll
            // position. `inline border-0 p-0` makes it occupy exactly what
            // the bare digit it replaced did.
            className="inline cursor-pointer border-0 p-0 text-[var(--color-accent)] no-underline hover:underline focus:outline-none"
          >
            {label}
          </PopoverButton>
          <PopoverPanel
            anchor="top"
            className="elev-md z-30 w-72 rounded-md border border-divider bg-surface p-3 text-[13px] leading-[1.6] normal-case [--anchor-gap:8px]"
          >
            <button
              type="button"
              aria-label="Close footnote"
              className="float-right -mt-1 -mr-1 px-1 opacity-50 hover:opacity-100 focus:outline-none"
              onClick={close}
            >
              ×
            </button>
            <span className="font-reading" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          </PopoverPanel>
        </span>
      )}
    </Popover>
  );
}
