import { isPromptType, PROMPT_TYPES, CONNECTOR_PROMPT_TYPES, presetTypeFor } from "@/lib/prompts";

// The bug this pins: the create route recognised "google_ads" and
// "preset_questions" and turned every other type into "core", so a prompt
// saved as the GA4 analyst came back badged Core Analyst and the GA4 analyst
// never used it. Editing a prompt's type was dropped entirely.

describe("isPromptType", () => {
  it("accepts every type the library lists", () => {
    for (const t of PROMPT_TYPES) expect(isPromptType(t)).toBe(true);
  });

  it("accepts the per-source analyst types that used to fall through to core", () => {
    for (const t of ["ga4", "meta_ads", "shopify"]) expect(isPromptType(t)).toBe(true);
  });

  it("accepts every connector's preset type", () => {
    for (const c of CONNECTOR_PROMPT_TYPES) expect(isPromptType(presetTypeFor(c))).toBe(true);
  });

  it("refuses anything else rather than letting it become core", () => {
    for (const v of ["", "Core Analyst", "google-ads", "notatype", null, undefined, 7, {}])
      expect(isPromptType(v)).toBe(false);
  });

  it("covers both analyst and preset types for every connector", () => {
    // A source added to CONNECTOR_PROMPT_TYPES without its entries here would
    // be saveable in the form and rejected by the route.
    for (const c of CONNECTOR_PROMPT_TYPES) {
      expect(PROMPT_TYPES).toContain(c);
      expect(PROMPT_TYPES).toContain(`preset_${c}`);
    }
  });
});
