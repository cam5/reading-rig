/**
 * Display locators.
 *
 * The design writes a position in a work as `§4 ¶3`, and a span as `§4 ¶2–3`.
 * Those strings are always *derived* — never stored — so that a re-ingest that
 * renumbers a section cannot leave a note captioned with a locator that no
 * longer points anywhere. See the plan's locator model.
 *
 * This is the seed of the module #5 fills out; it currently knows only how to
 * render a locator, not how to resolve one.
 */

export type Locator = {
  /** The section's own label, without the §. Sections are not always numeric. */
  sectionLabel: string;
  /** 1-based paragraph number within the section — the ¶3. */
  paragraphOrdinal: number;
};

const SECTION = "§"; // §
const PILCROW = "¶"; // ¶
const EN_DASH = "–"; // – (ranges take an en dash, not a hyphen)

export function formatLocator({
  sectionLabel,
  paragraphOrdinal,
}: Locator): string {
  return `${SECTION}${sectionLabel} ${PILCROW}${paragraphOrdinal}`;
}

/**
 * A span between two locators. Collapses to a single locator when they match,
 * and to `§4 ¶2–3` when only the paragraph differs — the form the design uses
 * for the context chips.
 */
export function formatLocatorRange(from: Locator, to: Locator): string {
  if (from.sectionLabel !== to.sectionLabel) {
    return `${formatLocator(from)} ${EN_DASH} ${formatLocator(to)}`;
  }
  if (from.paragraphOrdinal === to.paragraphOrdinal) {
    return formatLocator(from);
  }
  return `${formatLocator(from)}${EN_DASH}${to.paragraphOrdinal}`;
}
