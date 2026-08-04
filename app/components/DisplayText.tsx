import type { DisplayString } from "~/domain/typography/displayStrings";

type Props = {
  text: DisplayString;
};

/**
 * Renders one of the closed set of Baloo 2 (display-face) strings — see
 * DISPLAY_STRINGS. Typing `text` as `DisplayString`, not `string`, turns any
 * call site that would render ingested/user text in Baloo 2 into a compile
 * error — the display face stays scoped to a short, deliberate list of UI
 * chrome, never dynamic content.
 *
 * Deliberately just the text, not a wrapping element: the surrounding
 * `<button>`/`<span>`/`<h1>` at each call site keeps its own tag,
 * className, and event handlers untouched.
 */
export function DisplayText({ text }: Props) {
  return <>{text}</>;
}
