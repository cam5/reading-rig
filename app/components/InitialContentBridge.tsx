import { Suspense, useEffect, useRef } from "react";
import { Await } from "react-router";
import type { ContentWindowParagraph } from "~/domain/reading/fetchContentWindow.server";
import type { OrdinalRange } from "~/domain/reading/scrollPosition";

type ResolvedContent = { paragraphs: ContentWindowParagraph[] } & OrdinalRange;

type Props = {
  content: Promise<ResolvedContent>;
  onResolved: (paragraphs: ContentWindowParagraph[], range: OrdinalRange) => void;
};

/**
 * Bridges read.tsx's streamed `content` promise (PR2 — not awaited in the
 * loader, so the shell/skeletons can flush before it resolves) into
 * useContentWindow's `applyInitialContent`. A hook can't itself host a
 * `Suspense`/`Await` boundary, so this tiny component is what read.tsx
 * mounts instead — invisible either way (`fallback`/`errorElement` are both
 * `null`), since the row loop already renders ReadingParagraphSkeleton for
 * anything not yet in `contentById`, resolved or not.
 */
export function InitialContentBridge({ content, onResolved }: Props) {
  return (
    <Suspense fallback={null}>
      <Await resolve={content} errorElement={null}>
        {(resolved: ResolvedContent) => <ApplyOnce resolved={resolved} onResolved={onResolved} />}
      </Await>
    </Suspense>
  );
}

// Applying in an effect (not the Await render-prop body) avoids a
// setState-during-render call into useContentWindow's state. Guarded so a
// later loader revalidation (a new `content` promise after a highlight/
// bookmark action) doesn't re-merge the initial window a second time —
// same "seed once" semantics PR1's synchronous initializer had.
function ApplyOnce({
  resolved,
  onResolved,
}: {
  resolved: ResolvedContent;
  onResolved: Props["onResolved"];
}) {
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    onResolved(resolved.paragraphs, {
      minGlobalOrdinal: resolved.minGlobalOrdinal,
      maxGlobalOrdinal: resolved.maxGlobalOrdinal,
    });
  }, [resolved, onResolved]);

  return null;
}
