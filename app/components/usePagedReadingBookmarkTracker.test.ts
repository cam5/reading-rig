import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM or React renderer in this test environment (see vitest.config.ts)
// — and this hook needs neither: it's useState/useRef/useEffect over plain
// values. A minimal slot-indexed stand-in for those three runs it for real,
// effects and dependency arrays included, so what's asserted is the hook's
// own gating, not a mock of it.
const harness = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: unknown[] };
  const state = {
    slots: [] as Slot[],
    cursor: 0,
    effects: [] as (() => void)[],
  };
  return {
    state,
    begin() {
      state.cursor = 0;
      state.effects = [];
    },
    flush() {
      for (const run of state.effects) run();
    },
  };
});

vi.mock("react", () => {
  const { state } = harness;
  const slot = () => (state.slots[state.cursor++] ??= {});
  return {
    useRef<T>(initial: T) {
      const s = slot();
      if (!("value" in s)) s.value = { current: initial };
      return s.value as { current: T };
    },
    useState<T>(initial: T) {
      const s = slot();
      if (!("value" in s)) s.value = initial;
      return [s.value as T, (next: T) => void (s.value = next)];
    },
    useEffect(run: () => void, deps: unknown[]) {
      const s = slot();
      const changed = !s.deps || deps.some((d, i) => !Object.is(d, s.deps![i]));
      s.deps = deps;
      if (changed) state.effects.push(run);
    },
  };
});

const submit = vi.fn();
vi.mock("react-router", () => ({ useFetcher: () => ({ submit }) }));

const { usePagedReadingBookmarkTracker } =
  await import("./usePagedReadingBookmarkTracker");

const replaceState = vi.fn();
vi.stubGlobal("window", { history: { replaceState } });

const section = { chapterId: "c1", sectionId: "s1" };
const paragraphs = {
  p1: { globalOrdinal: 1, wordCount: 400, section },
  p2: { globalOrdinal: 2, wordCount: 400, section },
};

function render(enabled: boolean, pageKey = "p1:0") {
  harness.begin();
  const result = usePagedReadingBookmarkTracker({
    workId: "w1",
    paragraphs,
    totalParagraphs: 2,
    initialGlobalOrdinal: 0,
    initialProgressPercent: 0,
    initialTimeLeft: "loader's value",
    onSectionChange,
    visibleItems: [{ id: "p1", topPx: -100, bottomPx: 200 }],
    pageKey,
    enabled,
  });
  harness.flush();
  return result;
}
const onSectionChange = vi.fn();

beforeEach(() => {
  harness.state.slots = [];
  submit.mockClear();
  replaceState.mockClear();
  onSectionChange.mockClear();
});

describe("usePagedReadingBookmarkTracker's `enabled` gate", () => {
  it("resolves nothing while disabled, across re-renders and page keys", () => {
    render(false);
    render(false, "p2:0");
    expect(render(false).timeLeft).toBe("loader's value");
    expect(submit).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it("resolves exactly once when it becomes enabled, then only on page turns", () => {
    render(false);
    render(true);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(onSectionChange).toHaveBeenCalledWith(section);
    // The resolve's setProgress lands on the next render.
    expect(render(true).timeLeft).toBe("2 min left");
    expect(replaceState).toHaveBeenCalledTimes(1);
    render(true, "p2:0");
    expect(replaceState).toHaveBeenCalledTimes(2);
  });

  it("resolves on mount when enabled from the start, as before", () => {
    render(true);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });
});
