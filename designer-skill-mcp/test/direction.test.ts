import { describe, it, expect } from "vitest";
import { commitDesignDirection } from "../src/direction.js";

const validDirection = {
  register: "brand" as const,
  designRead: "Independent invoicing tool for solo consultants, with a precise editorial ledger language",
  designVariance: 7,
  motionIntensity: 4,
  visualDensity: 5,
  aesthetic: "brand-identity",
  physicalScene: "Solo founder reviewing metrics at 6am in a dim apartment, laptop glow on face",
  layoutFamilies: ["asymmetric bento", "single-purpose viewport"],
  typographyDirection: "Neo-grotesk display + humanist body, 1.333 scale ratio",
  antiSlopRisks: ["no cream background", "no three equal feature cards"],
  inverseTestPass: true,
  inverseTestDescription:
    "Ledger-style invoicing for freelancers who work from coffee shops — monospace amounts on receipt-paper texture, not another fintech navy dashboard",
  namedReferences: ["Linear marketing restraint", "Klim type confidence"],
};

describe("commitDesignDirection", () => {
  it("PASSes a complete brand direction", () => {
    const r = commitDesignDirection(validDirection);
    expect(r.status).toBe("PASS");
    expect(r.direction?.register).toBe("brand");
  });

  it("FAILs when inverse test is not passed", () => {
    const r = commitDesignDirection({ ...validDirection, inverseTestPass: false });
    expect(r.status).toBe("FAIL");
    expect(r.fixes?.some((f) => f.includes("inverseTestPass"))).toBe(true);
  });

  it("FAILs category-modal inverse descriptions", () => {
    const r = commitDesignDirection({
      ...validDirection,
      inverseTestDescription: "AI-powered workflow that streamlines your creative process seamlessly",
    });
    expect(r.status).toBe("FAIL");
    expect(r.fixes?.some((f) => f.includes("category-modal"))).toBe(true);
  });

  it("FAILs brand surfaces with only one layout family", () => {
    const r = commitDesignDirection({
      ...validDirection,
      layoutFamilies: ["asymmetric bento"],
    });
    expect(r.status).toBe("FAIL");
    expect(r.fixes?.some((f) => f.includes("layoutFamilies"))).toBe(true);
  });

  it("FAILs vague physical scenes", () => {
    const r = commitDesignDirection({
      ...validDirection,
      physicalScene: "Modern users who want a clean experience",
    });
    expect(r.status).toBe("FAIL");
  });

  it("FAILs incomplete calibration", () => {
    const r = commitDesignDirection({
      ...validDirection,
      designRead: "Clean modern app",
      designVariance: 11,
      motionIntensity: 4.5,
    });
    expect(r.status).toBe("FAIL");
    expect(r.fixes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("designRead"),
        expect.stringContaining("designVariance"),
        expect.stringContaining("motionIntensity"),
      ]),
    );
  });
});
