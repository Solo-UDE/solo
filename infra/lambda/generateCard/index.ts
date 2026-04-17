import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import satori, { type SatoriOptions } from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { ddb, env } from "../shared/ddb.js";
import { extractUser, json } from "../shared/auth.js";
import { TIER_NAMES } from "../shared/tier.js";

const s3 = new S3Client({});

// Lambda runtime extracts the bundle to /var/task/. The afterBundling hook in
// api-stack.ts copies the resvg WASM blob alongside the JS bundle, so we can
// resolve it deterministically via Lambda's LAMBDA_TASK_ROOT env var. Falls
// back to cwd for local `cdk synth` or test runs.
const TASK_ROOT = process.env.LAMBDA_TASK_ROOT ?? process.cwd();
const WASM_PATH = path.join(
  TASK_ROOT,
  "node_modules",
  "@resvg",
  "resvg-wasm",
  "index_bg.wasm",
);

// =============================================================================
// Card rendering pipeline
// =============================================================================
//
// 1. Build a JSX-less element tree for satori
// 2. satori → SVG (uses the loaded font for text metrics)
// 3. @resvg/resvg-wasm → PNG (1200x630)
//
// Resvg needs its WASM module initialized exactly once per Lambda container;
// `initWasmOnce` memoizes that. Satori needs at least one font; we pull
// Inter Regular & Bold from Google Fonts on first invocation and cache the
// ArrayBuffers for the lifetime of the container.

let wasmReady: Promise<void> | null = null;
async function initWasmOnce(): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const bytes = await readFile(WASM_PATH);
      await initWasm(bytes);
    })();
  }
  return wasmReady;
}

let fontsPromise: Promise<SatoriOptions["fonts"]> | null = null;
async function loadFonts(): Promise<SatoriOptions["fonts"]> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const [regular, bold] = await Promise.all([
        fetchFontBytes(
          "https://fonts.gstatic.com/s/inter/v19/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7SUc.woff",
        ),
        fetchFontBytes(
          "https://fonts.gstatic.com/s/inter/v19/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff",
        ),
      ]);
      return [
        { name: "Inter", data: regular, weight: 400, style: "normal" },
        { name: "Inter", data: bold, weight: 700, style: "normal" },
      ];
    })();
  }
  return fontsPromise;
}

async function fetchFontBytes(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`font fetch ${resp.status}`);
  return resp.arrayBuffer();
}

// =============================================================================
// Tier styling
// =============================================================================

const TIER_COLORS: Record<number, { bg: string; accent: string; emoji: string }> = {
  1: { bg: "#0B1F13", accent: "#4ADE80", emoji: "🌳" },
  2: { bg: "#0A1A2B", accent: "#60A5FA", emoji: "🏝️" },
  3: { bg: "#0A1E2C", accent: "#38BDF8", emoji: "🌊" },
  4: { bg: "#14191F", accent: "#A3E635", emoji: "💨" },
  5: { bg: "#1B1510", accent: "#F59E0B", emoji: "⛰️" },
  6: { bg: "#1A0F24", accent: "#C084FC", emoji: "💎" },
  7: { bg: "#0A0A17", accent: "#FCD34D", emoji: "✨" },
};

interface CardPayload {
  tier: number;
  tierName: string;
  commits: number;
  tokens: number;
  worktrees: number;
  score: number;
  githubUsername: string | null;
}

// satori accepts a virtual-DOM-like object tree; `type` is the tag, `props.children`
// is the array or single child. Written without JSX so this file compiles without
// a JSX transformer and without needing the React types.
type Node =
  | string
  | {
      type: string;
      props: { style?: Record<string, unknown>; children?: Node | Node[] };
    };

function el(
  type: string,
  style: Record<string, unknown>,
  ...children: Node[]
): Node {
  return { type, props: { style, children } };
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function buildCardTree(payload: CardPayload): Node {
  const palette = TIER_COLORS[payload.tier] ?? TIER_COLORS[1];
  const scorePts = Math.round(payload.score * 100);

  const statTile = (label: string, value: string): Node =>
    el(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        padding: "16px 20px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        minWidth: 170,
      },
      el(
        "span",
        {
          fontSize: 12,
          color: "rgba(255,255,255,0.55)",
          textTransform: "uppercase",
          letterSpacing: 2,
          fontWeight: 700,
        },
        label,
      ),
      el(
        "span",
        { fontSize: 32, color: "#fff", fontWeight: 700, marginTop: 6 },
        value,
      ),
    );

  return el(
    "div",
    {
      width: 1200,
      height: 630,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: 60,
      background: `linear-gradient(135deg, ${palette.bg} 0%, #000000 100%)`,
      color: "#fff",
      fontFamily: "Inter",
    },

    // Top row: tier badge + username
    el(
      "div",
      { display: "flex", justifyContent: "space-between", alignItems: "center" },
      el(
        "div",
        { display: "flex", alignItems: "center", gap: 16 },
        el("span", { fontSize: 64 }, palette.emoji),
        el(
          "div",
          { display: "flex", flexDirection: "column" },
          el(
            "span",
            {
              fontSize: 14,
              color: palette.accent,
              textTransform: "uppercase",
              letterSpacing: 3,
              fontWeight: 700,
            },
            `Tier ${payload.tier}`,
          ),
          el(
            "span",
            { fontSize: 36, fontWeight: 700, marginTop: 4 },
            payload.tierName,
          ),
        ),
      ),
      el(
        "span",
        { fontSize: 16, color: "rgba(255,255,255,0.55)" },
        payload.githubUsername ? `@${payload.githubUsername}` : "Solo IDE",
      ),
    ),

    // Middle: score centerpiece
    el(
      "div",
      { display: "flex", flexDirection: "column", alignItems: "flex-start" },
      el(
        "span",
        {
          fontSize: 14,
          color: "rgba(255,255,255,0.55)",
          textTransform: "uppercase",
          letterSpacing: 3,
          fontWeight: 700,
        },
        "Score",
      ),
      el(
        "span",
        {
          fontSize: 140,
          fontWeight: 700,
          lineHeight: 1,
          color: palette.accent,
          marginTop: 4,
        },
        `${scorePts}`,
      ),
    ),

    // Bottom: stats + wordmark
    el(
      "div",
      { display: "flex", flexDirection: "column", gap: 24 },
      el(
        "div",
        { display: "flex", gap: 16 },
        statTile("Commits", formatCompact(payload.commits)),
        statTile("Tokens", formatCompact(payload.tokens)),
        statTile("Worktrees", formatCompact(payload.worktrees)),
      ),
      el(
        "div",
        {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        },
        el(
          "span",
          { fontSize: 18, color: "rgba(255,255,255,0.45)" },
          "solo.dev",
        ),
        el(
          "span",
          {
            fontSize: 12,
            color: "rgba(255,255,255,0.35)",
            textTransform: "uppercase",
            letterSpacing: 3,
          },
          "Build your journey",
        ),
      ),
    ),
  );
}

async function renderCardPng(payload: CardPayload): Promise<Buffer> {
  await initWasmOnce();
  const fonts = await loadFonts();
  const tree = buildCardTree(payload);
  // satori's Element type is loose; cast once at the boundary.
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts,
  });
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
  return Buffer.from(resvg.render().asPng());
}

// =============================================================================
// Handler
// =============================================================================

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const user = extractUser(event);
  const statsTable = env("STATS_TABLE");
  const shareTable = env("SHARE_CARDS_TABLE");
  const bucket = env("SHARE_CARDS_BUCKET");

  const { Item } = await ddb.send(
    new GetCommand({ TableName: statsTable, Key: { userId: user.userId } }),
  );
  if (!Item) return json(404, { error: "no stats for user yet" });

  const cardId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const key = `${user.userId}/${cardId}.png`;

  const png = await renderCardPng({
    tier: (Item.tier as number) ?? 1,
    tierName: TIER_NAMES[(Item.tier as number) ?? 1] ?? "Trees",
    commits: Number(Item.commits ?? 0),
    tokens: Number(Item.tokens ?? 0),
    worktrees: Number(Item.worktrees ?? 0),
    score: Number(Item.score ?? 0),
    githubUsername: (Item.github_username as string) ?? null,
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: png,
      ContentType: "image/png",
      CacheControl: "public, max-age=604800",
    }),
  );

  const ttl = Math.floor(Date.now() / 1000) + 7 * 86400;
  await ddb.send(
    new PutCommand({
      TableName: shareTable,
      Item: {
        userId: user.userId,
        cardId,
        s3_key: key,
        generated_at: new Date().toISOString(),
        ttl,
      },
    }),
  );

  // Signed GET URL (was mistakenly PutObjectCommand — a PUT URL is useless
  // to the caller since the object is already uploaded).
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 7 * 86400 },
  );

  return json(200, { cardId, url, expiresInSeconds: 7 * 86400 });
};
