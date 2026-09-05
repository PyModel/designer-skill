import { describe, it, expect } from "vitest";
import { commitDesignDirection } from "../src/direction.js";
const valid = {
  register: "product" as const,
  designRead: "Independent invoicing for consultants using the approved ledger identity.",
  contextSources: ["PRODUCT.md", "src/tokens.css"], aesthetic: "brand-identity",
  typographyDirection: "Approved single font family with a readable type scale", layoutFamilies: ["ledger"],
};
describe("design direction input validation", () => {
  it("accepts a contextual direction without claiming enforcement", () => {
    const result = commitDesignDirection(valid);
    expect(result.status).toBe("PASS"); expect(result.scope).toBe("input-validation");
    expect(result.directionId).toMatch(/^[a-f0-9]{64}$/);
    expect(result.message).toContain("does not prove");
  });
  it("allows an existing identity to be preserved without ceremony", () => {
    expect(commitDesignDirection({ mode: "preserve", register: "product", contextSources: ["src/form.css"],
      designRead: "Repair existing form alignment without changing the approved identity." }).status).toBe("PASS");
  });
  it("does not treat inverse-test booleans or vocabulary as proof of design quality", () => {
    expect(commitDesignDirection({ ...valid, inverseTestPass: false,
      inverseTestDescription: "AI-powered workflow for the documented product audience" }).status).toBe("PASS");
  });
  it("accepts custom aesthetics and a single appropriate layout", () => {
    expect(commitDesignDirection({ ...valid, aesthetic: "museum-wayfinding" }).status).toBe("PASS");
  });
  it("rejects duplicate layout entries rather than counting them as variety", () => {
    expect(commitDesignDirection({ ...valid, layoutFamilies: ["ledger", "ledger"] }).status).toBe("FAIL");
  });
  it("requires inspected context sources", () => {
    expect(commitDesignDirection({ ...valid, contextSources: [] }).status).toBe("FAIL");
  });
  it("rejects invalid dials and incomplete inputs", () => {
    const result = commitDesignDirection({ ...valid, designRead: "Too short", designVariance: 11, motionIntensity: 4.5 });
    expect(result.status).toBe("FAIL");
    for (const field of ["designRead", "designVariance", "motionIntensity"]) expect(result.fixes?.some((f) => f.includes(field))).toBe(true);
  });
});
