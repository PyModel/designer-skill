// Niblet catalogue adapter (https://niblet.com): real-screen UI references
// for visually-led work. Deep module — callers ask two questions; token
// handling, origin configuration, bounded fetch, and text shaping stay inside.
// Without NIBLET_TOKEN every call degrades to guidance text, never an error:
// catalogue retrieval is optional, never a prerequisite to useful work.
const DEFAULT_API_ORIGIN = "https://api.niblet.com";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;
const CLIENT = "designer-skill-mcp";

export interface UiReference {
  id: string;
  app: string;
  platform: string;
  screenType: string | null;
  summary: string | null;
  width: number | null;
  height: number | null;
  thumbUrl: string;
  inspectUrl: string;
}

export interface CatalogueAnswer {
  configured: boolean;
  text: string;
}

function apiOrigin(): string {
  return process.env.NIBLET_API_ORIGIN?.trim() || DEFAULT_API_ORIGIN;
}

function token(): string | null {
  return process.env.NIBLET_TOKEN?.trim() || null;
}

export function nibletConfigured(): boolean {
  return token() !== null;
}

function notConfiguredText(): string {
  return [
    "Niblet catalogue not configured — no references were fetched.",
    "To enable: create a key at https://www.niblet.com/account, set it as NIBLET_TOKEN in this MCP server's environment, and restart the server.",
    "Until then, continue with the bundled reference files (get_reference); catalogue retrieval is optional.",
  ].join("\n");
}

async function requestJson(path: string, params: Record<string, string | number | undefined>): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const url = new URL(path, apiOrigin());
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token()}` },
      credentials: "omit",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.redirected) return { ok: false, message: "Niblet API redirects are not allowed." };
    if (!response.ok) {
      return {
        ok: false,
        message:
          response.status === 401 || response.status === 403
            ? "Niblet API rejected the NIBLET_TOKEN key. Create a fresh niblet_at_ key at https://www.niblet.com/account and restart the server."
            : `Niblet API request failed (HTTP ${response.status}). No retry was attempted.`,
      };
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return { ok: false, message: "Niblet API response exceeded 2 MiB and was not read." };
    return { ok: true, data: JSON.parse(new TextDecoder().decode(body)) };
  } catch {
    return { ok: false, message: "Niblet API could not be reached within 15 seconds. No retry was attempted." };
  } finally {
    clearTimeout(timer);
  }
}

function str(value: unknown, max = 2000): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function parseReference(raw: unknown): UiReference | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 160);
  const app = str(r.app, 200);
  const platform = str(r.platform, 40);
  if (!id || !app || !platform) return null;
  return {
    id,
    app,
    platform,
    screenType: str(r.screenType, 200),
    summary: str(r.summary, 400),
    width: typeof r.width === "number" ? r.width : null,
    height: typeof r.height === "number" ? r.height : null,
    thumbUrl: str(r.thumbUrl) ?? "",
    inspectUrl: str(r.inspectUrl) ?? "",
  };
}

function referenceText(ref: UiReference, index: number): string {
  const size = ref.width && ref.height ? `, ${ref.width}×${ref.height}` : "";
  return [
    `${index + 1}. ${ref.app} — ${ref.screenType ?? "screen"} (${ref.platform}${size}) id=${ref.id}`,
    ref.summary ? `   ${ref.summary}` : null,
    ref.inspectUrl ? `   image: ${ref.inspectUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Find up to three real full-screen references for a concrete UI question. */
export async function findUiReferences(
  query: string,
  options: { platform?: "web" | "ios"; limit?: number } = {},
): Promise<CatalogueAnswer> {
  if (!nibletConfigured()) return { configured: false, text: notConfiguredText() };
  const limit = Math.min(Math.max(options.limit ?? 2, 1), 3);
  const result = await requestJson("/v1/search", { q: query, platform: options.platform, limit, client: CLIENT });
  if (!result.ok) return { configured: true, text: `${result.message}\nContinue with the bundled reference files (get_reference).` };
  const data = result.data as { results?: unknown[] };
  const refs = (Array.isArray(data.results) ? data.results : []).map(parseReference).filter((r): r is UiReference => r !== null).slice(0, limit);
  if (refs.length === 0) {
    return { configured: true, text: "No relevant references. Continue with the product brief and existing design system." };
  }
  const lines = refs.map((r, i) => referenceText(r, i));
  if (refs.some((r) => r.platform === "web")) {
    lines.push("", "A recorded style reference exists for the web screens above: call get_design_reference with the screenId to read its colors, typography, and components.");
  }
  return { configured: true, text: lines.join("\n") };
}

/** Read the recorded style reference (colors, typography, components) for a web screen or pack. */
export async function getDesignReference(
  options: { screenId?: string; packSlug?: string; sections?: string[] } = {},
): Promise<CatalogueAnswer> {
  if (!nibletConfigured()) return { configured: false, text: notConfiguredText() };
  const result = await requestJson("/v1/design-reference", {
    screenId: options.screenId,
    packSlug: options.packSlug,
    sections: options.sections?.length ? options.sections.join(",") : undefined,
    client: CLIENT,
  });
  if (!result.ok) return { configured: true, text: `${result.message}\nContinue with the bundled reference files (get_reference).` };
  const data = result.data as { markdown?: unknown };
  const markdown = str(data.markdown, 200_000);
  if (!markdown) return { configured: true, text: "No design reference recorded for that screen. Continue with the local design system." };
  return { configured: true, text: markdown };
}
