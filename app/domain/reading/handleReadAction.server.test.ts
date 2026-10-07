import { describe, expect, it } from "vitest";
import { handleReadAction } from "./handleReadAction.server";

// An unknown intent is rejected before any handler (and so the database)
// is reached — nothing here needs a real one.
const unusedDb = {} as Parameters<typeof handleReadAction>[0];

async function rejectedResponse(formData: FormData): Promise<Response> {
  try {
    await handleReadAction(
      unusedDb,
      { id: "user-1" },
      formData,
      "http://localhost/read/some-work",
      "web",
    );
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
  throw new Error("expected handleReadAction to throw a Response");
}

describe("handleReadAction — an intent it doesn't dispatch on", () => {
  it("400s naming the intent it received and the ones it accepts", async () => {
    const formData = new FormData();
    formData.set("intent", "hilight");
    const response = await rejectedResponse(formData);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      'Unknown intent "hilight" — expected one of: highlight, highlight-note, note, bookmark',
    );
  });

  it('says so when no intent was sent at all, rather than echoing "null"', async () => {
    const response = await rejectedResponse(new FormData());

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Unknown intent (none)");
  });

  it("caps how much of an arbitrary intent value it echoes back", async () => {
    const formData = new FormData();
    formData.set("intent", "x".repeat(5000));
    const response = await rejectedResponse(formData);

    expect((await response.text()).length).toBeLessThan(200);
  });

  it("doesn't treat an inherited Object property as an intent", async () => {
    const formData = new FormData();
    formData.set("intent", "constructor");
    const response = await rejectedResponse(formData);

    expect(response.status).toBe(400);
  });
});
