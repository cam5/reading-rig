import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  /** Markdown source for an agent reply — see toTranscriptItems.ts. Agent
   * text never carries the ⟦pill⟧/⟦context⟧ markers RigMessage's
   * `renderUserText` unwraps, so there's nothing to parse out first. */
  text: string;
  /** Appended to `text` as a plain trailing glyph rather than rendered as
   * its own styled/pulsing `<span>`: the last markdown node is block-level
   * (a `<p>`, `<li>`, …), so a sibling element after it drops to its own
   * line instead of sitting inline after the last word the way
   * RigMessage's plain-text path renders the cursor. */
  showCursor?: boolean;
};

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--color-accent-700)] underline decoration-[var(--color-accent-300)] underline-offset-2 hover:decoration-[var(--color-accent-700)]"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-[var(--color-divider)] pl-3 italic text-[var(--color-neutral-700)] last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[var(--color-divider)]" />,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-3 text-[16px] font-semibold first:mt-0 last:mb-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 text-[15.5px] font-semibold first:mt-0 last:mb-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0 last:mb-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-2 text-[14px] font-semibold first:mt-0 last:mb-0">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="mb-1.5 mt-2 text-[14px] font-semibold first:mt-0 last:mb-0">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="mb-1.5 mt-2 text-[14px] font-semibold first:mt-0 last:mb-0">
      {children}
    </h6>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-md bg-[var(--color-neutral-200)] p-3 text-[13px] leading-normal last:mb-0">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    // A fenced block only picks up a `language-*` class when the fence's
    // info string names one (```ts, not bare ```) — a language-less fence
    // is indistinguishable from inline code at this layer, so it falls
    // back to the inline pill style below. Cosmetic only: the text itself
    // still renders correctly, just without the block chrome.
    const isFenced = /language-/.test(className ?? "");
    if (isFenced) return <code className={className}>{children}</code>;
    return (
      <code className="rounded bg-[var(--color-neutral-200)] px-1 py-0.5 font-mono text-[13px]">
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-[var(--color-divider)] px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-[var(--color-divider)] px-2 py-1 align-top">
      {children}
    </td>
  ),
};

/**
 * Agent replies as markdown — Claude's own output is markdown by default
 * (bold, lists, headers, code), and RigMessage previously dumped it as an
 * inert string. Deliberately not shared with `renderUserText`: user turns
 * are the reader's own typing plus ⟦pill⟧/⟦context⟧ markers, never
 * markdown worth parsing.
 */
export function RigMessageMarkdown({ text, showCursor = false }: Props) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {showCursor ? `${text}▊` : text}
    </Markdown>
  );
}
