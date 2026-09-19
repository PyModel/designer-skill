// Niblet catalogue adapter tests: not-configured guidance (the default
// experience) and the full REST path against a local stub of api.niblet.com.
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, describe, it, expect } from "vitest";
import { findUiReferences, getDesignReference, nibletConfigured } from "../src/niblet.js";

let stub: Server | null = null;
let origin = "";
const savedToken = process.env.NIBLET_TOKEN;
const savedOrigin = process.env.NIBLET_API_ORIGIN;

function startStub(): Promise<void> {
  stub = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/v1/search") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          results: [
            {
              id: "scr-001",
              app: "Acme Settings",
              platform: "web",
              screenType: "settings",
              summary: "Subscription status with renewal date and one primary action",
              width: 1440,
              height: 900,
              thumbUrl: "",
              inspectUrl: "https://media.niblet.com/scr-001.webp",
            },
          ],
        }),
      );
      return;
    }
    if (url.pathname === "/v1/design-reference") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ markdown: "# Acme Settings reference\n\nColors: …\nTypography: …" }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return new Promise((resolvePromise) => {
    stub!.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${(stub!.address() as AddressInfo).port}`;
      resolvePromise();
    });
  });
}

afterAll(() => stub?.close());
afterEach(() => {
  if (savedToken === undefined) delete process.env.NIBLET_TOKEN;
  else process.env.NIBLET_TOKEN = savedToken;
  if (savedOrigin === undefined) delete process.env.NIBLET_API_ORIGIN;
  else process.env.NIBLET_API_ORIGIN = savedOrigin;
});

describe("niblet adapter — unconfigured", () => {
  it("degrades to setup guidance, never an error", async () => {
    delete process.env.NIBLET_TOKEN;
    expect(nibletConfigured()).toBe(false);
    const answer = await findUiReferences("pricing page");
    expect(answer.configured).toBe(false);
    expect(answer.text).toContain("niblet.com/account");
    expect(answer.text).toContain("optional");
  });
});

describe("niblet adapter — REST path against local stub", () => {
  it("finds references and points at get_design_reference for web screens", async () => {
    await startStub();
    process.env.NIBLET_TOKEN = "niblet_at_test_key";
    process.env.NIBLET_API_ORIGIN = origin;
    const answer = await findUiReferences("subscription settings with clear renewal status", { platform: "web" });
    expect(answer.configured).toBe(true);
    expect(answer.text).toContain("Acme Settings");
    expect(answer.text).toContain("id=scr-001");
    expect(answer.text).toContain("get_design_reference");
  });

  it("returns markdown for a recorded design reference", async () => {
    process.env.NIBLET_TOKEN = "niblet_at_test_key";
    process.env.NIBLET_API_ORIGIN = origin;
    const answer = await getDesignReference({ screenId: "scr-001", sections: ["colors"] });
    expect(answer.configured).toBe(true);
    expect(answer.text).toContain("Acme Settings reference");
  });
});
