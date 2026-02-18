#!/usr/bin/env bun
/**
 * c3po-shopping-ml.ts — Busca e ranqueia produtos no Mercado Livre (Brasil).
 *
 * Usa a API do Mercado Livre (site MLB) com autenticação OAuth (usuário).
 * Tokens são gerenciados automaticamente em ~/.config/c3po/ml-token.json.
 *
 * SETUP INICIAL (uma vez):
 *   1. Gere o authorization URL:
 *      https://auth.mercadolivre.com.br/authorization?response_type=code
 *        &client_id=$ML_APP_ID&redirect_uri=https://SUA_URI
 *   2. Faça login, copie o "code" (TG-xxx) da URL de redirect
 *   3. Execute:
 *      bun scripts/c3po-shopping-ml.ts \
 *        --setup TG-xxx https://SUA_URI
 *   Isso salva access_token + refresh_token no cache e renova automaticamente.
 *
 * USO NORMAL (após setup):
 *   bun scripts/c3po-shopping-ml.ts --query "liquidificador mondial"
 *   bun scripts/c3po-shopping-ml.ts \
 *     --query "liquidificador" --max-price 200 --min-rating 4.0 --limit 20
 *
 * NOTA: A API de busca do ML bloqueia IPs de servidor (PolicyAgent 403).
 * Se o script retornar erro de PolicyAgent, use busca via browser em
 * mercadolivre.com.br como alternativa (ver AGENTS.md §Shopping).
 *
 * Variáveis de ambiente necessárias: ML_APP_ID, ML_APP_SECRET.
 * O token OAuth é gerenciado no cache — não é mais necessário ML_REFRESH_TOKEN.
 */

import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

// --- Tipos ---

interface MLSearchResult {
  id: string;
  title: string;
  price: number;
  currency_id: string;
  condition: string;
  permalink: string;
  thumbnail: string;
  shipping: {
    free_shipping: boolean;
    logistic_type: string;
    store_pick_up: boolean;
    tags?: string[];
  };
  seller: {
    id: number;
    nickname: string;
    power_seller_status?: string | null;
    reputation?: {
      level_id?: string;
      power_seller_status?: string | null;
    };
  };
  reviews?: {
    rating_average: number;
    total: number;
  };
  tags?: string[];
  official_store_id?: number | null;
  official_store_name?: string | null;
}

interface MLSearchResponse {
  results: MLSearchResult[];
  paging: {
    total: number;
    offset: number;
    limit: number;
  };
  available_filters?: unknown[];
  sort?: { id: string; name: string };
}

interface RankedProduct {
  rank: number;
  id: string;
  title: string;
  price: number;
  currency: string;
  condition: string;
  rating: number | null;
  reviews_total: number | null;
  free_shipping: boolean;
  estimated_delivery: string;
  estimated_delivery_ok: boolean;
  seller_type: "official_store" | "mercadolider_platinum" | "mercadolider_gold" | "mercadolider_silver" | "regular";
  seller_name: string;
  permalink: string;
  score: number;
}

// --- Token cache ---

const TOKEN_CACHE_PATH = `${process.env.HOME}/.config/c3po/ml-token.json`;
const ML_API = "https://api.mercadolibre.com";
// Renova o token se expira em menos de 10 minutos
const EXPIRY_BUFFER_MS = 10 * 60 * 1000;

interface TokenCache {
  access_token: string;
  refresh_token: string;
  expires_at: number; // timestamp Unix em ms
}

async function readTokenCache(): Promise<TokenCache | null> {
  try {
    const file = Bun.file(TOKEN_CACHE_PATH);
    if (!(await file.exists())) return null;
    return await file.json() as TokenCache;
  } catch {
    return null;
  }
}

async function writeTokenCache(cache: TokenCache): Promise<void> {
  const dir = dirname(TOKEN_CACHE_PATH);
  mkdirSync(dir, { recursive: true });
  await Bun.write(TOKEN_CACHE_PATH, JSON.stringify(cache, null, 2));
  // Protege o arquivo: apenas o dono pode ler (tokens são sensíveis)
  try { chmodSync(TOKEN_CACHE_PATH, 0o600); } catch { /* ignora em sistemas sem chmod */ }
}

async function exchangeCodeForTokens(
  appId: string,
  appSecret: string,
  code: string,
  redirectUri: string,
): Promise<TokenCache> {
  const resp = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const body = await resp.text();
  if (!resp.ok) {
    throw new Error(`ML rejeitou o code (${resp.status}): ${body}`);
  }

  const data = JSON.parse(body) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!data.refresh_token) {
    throw new Error(
      `ML não retornou refresh_token. Verifique se o app tem scope "offline_access" ` +
      `ou se o code já foi usado. Resposta: ${body}`
    );
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

async function refreshAccessToken(
  appId: string,
  appSecret: string,
  refreshToken: string,
): Promise<TokenCache> {
  const resp = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: appId,
      client_secret: appSecret,
      refresh_token: refreshToken,
    }),
  });

  const body = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `Falha ao renovar token ML (${resp.status}): ${body}. ` +
      `O refresh_token pode ter expirado. Reexecute --setup para obter um novo.`
    );
  }

  const data = JSON.parse(body) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    access_token: data.access_token,
    // ML rotaciona o refresh_token — usar o novo se vier, senão manter o anterior
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Retorna um access_token válido.
 * Verifica o cache, renova se necessário e salva o novo token.
 */
async function getValidToken(appId: string, appSecret: string): Promise<string> {
  const cache = await readTokenCache();

  if (!cache) {
    throw new Error(
      `Cache de token ML não encontrado em ${TOKEN_CACHE_PATH}. ` +
      `Execute primeiro: bun scripts/c3po-shopping-ml.ts --setup TG-xxx https://SUA_URI`
    );
  }

  // Token ainda válido (com margem de 10 min)
  if (cache.access_token && cache.expires_at > Date.now() + EXPIRY_BUFFER_MS) {
    return cache.access_token;
  }

  // Token expirado ou prestes a expirar — renovar
  const newCache = await refreshAccessToken(appId, appSecret, cache.refresh_token);
  await writeTokenCache(newCache);
  return newCache.access_token;
}

// --- Parsing de args ---

type Args =
  | { mode: "setup"; code: string; redirectUri: string }
  | {
      mode: "search";
      query: string;
      maxPrice: number | null;
      minRating: number;
      freeShipping: boolean;
      officialStore: boolean;
      limit: number;
    };

function parseArgs(): Args {
  const args = process.argv.slice(2);

  // Modo setup: --setup CODE REDIRECT_URI
  const setupIdx = args.indexOf("--setup");
  if (setupIdx !== -1) {
    const code = args[setupIdx + 1];
    const redirectUri = args[setupIdx + 2];
    if (!code || !redirectUri) {
      console.error(JSON.stringify({
        error: "Uso: --setup CODE REDIRECT_URI",
        example: 'bun scripts/c3po-shopping-ml.ts --setup TG-xxx https://mercadolivre.c',
      }));
      process.exit(1);
    }
    return { mode: "setup", code, redirectUri };
  }

  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const query = get("--query");
  if (!query) {
    console.error(JSON.stringify({
      error: "Parâmetro --query é obrigatório.",
      setup_hint: "Para configurar o token ML: bun scripts/c3po-shopping-ml.ts --setup TG-xxx https://SUA_URI",
    }));
    process.exit(1);
  }

  return {
    mode: "search",
    query,
    maxPrice: get("--max-price") ? Number(get("--max-price")) : null,
    minRating: get("--min-rating") ? Number(get("--min-rating")) : 4.0,
    freeShipping: has("--free-shipping"),
    officialStore: has("--official-store"),
    limit: get("--limit") ? Math.min(Number(get("--limit")), 50) : 20,
  };
}

// --- Estimativa de prazo de entrega ---

function estimateDelivery(item: MLSearchResult): { label: string; ok: boolean } {
  const logistic = item.shipping?.logistic_type ?? "not_specified";
  const powerSeller = item.seller?.power_seller_status
    ?? item.seller?.reputation?.power_seller_status
    ?? null;

  if (logistic === "fulfillment") {
    return { label: "≤3 dias", ok: true };
  }
  if (logistic === "xd_drop_off") {
    return powerSeller === "platinum" || powerSeller === "gold"
      ? { label: "≤5 dias", ok: true }
      : { label: "≤7 dias", ok: true };
  }
  if (logistic === "cross_docking") {
    return { label: powerSeller === "silver" ? "≤12 dias" : "≤12 dias", ok: true };
  }
  if (!powerSeller) {
    return { label: "⚠️ prazo incerto", ok: false };
  }
  return { label: "⚠️ verificar", ok: false };
}

// --- Tipo de seller ---

function sellerType(item: MLSearchResult): RankedProduct["seller_type"] {
  if (item.official_store_id) return "official_store";
  const ps = item.seller?.power_seller_status ?? item.seller?.reputation?.power_seller_status;
  if (ps === "platinum") return "mercadolider_platinum";
  if (ps === "gold") return "mercadolider_gold";
  if (ps === "silver") return "mercadolider_silver";
  return "regular";
}

// --- Score ponderado ---
// Peso: preço 35%, rating 25%, nº avaliações 15%, frete grátis 15%, seller 10%

function calcScore(
  item: MLSearchResult,
  minPrice: number,
  maxPrice: number,
  maxReviews: number
): number {
  const priceRange = maxPrice - minPrice;
  const priceScore = priceRange > 0 ? 1 - (item.price - minPrice) / priceRange : 1;

  const rating = item.reviews?.rating_average ?? 0;
  const ratingScore = rating / 5;

  const reviewsTotal = item.reviews?.total ?? 0;
  const reviewsScore = maxReviews > 0
    ? Math.log10(reviewsTotal + 1) / Math.log10(maxReviews + 1)
    : 0;

  const shippingScore = item.shipping?.free_shipping ? 1.0 : 0.3;

  const st = sellerType(item);
  const sellerScore =
    st === "official_store" ? 1.0
    : st === "mercadolider_platinum" ? 0.9
    : st === "mercadolider_gold" ? 0.8
    : st === "mercadolider_silver" ? 0.6
    : 0.3;

  const total =
    priceScore * 0.35 +
    ratingScore * 0.25 +
    reviewsScore * 0.15 +
    shippingScore * 0.15 +
    sellerScore * 0.10;

  return Math.round(total * 100 * 10) / 10;
}

// --- Busca na API do ML ---

async function searchML(
  query: string,
  limit: number,
  maxPriceParam: number | null,
  token: string
): Promise<MLSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    sort: "price_asc",
    limit: String(limit),
    ...(maxPriceParam ? { price: `*-${maxPriceParam}` } : {}),
  });

  const url = `${ML_API}/sites/MLB/search?${params}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "c3po-family-agent/1.0",
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
    },
  });

  if (resp.status === 403) {
    const body = await resp.text().catch(() => "");
    const isPolicy = body.includes("PA_UNAUTHORIZED") || body.includes("PolicyAgent") || body.includes("policyagent");
    const isIPBlock = body.includes("blocked") || body.includes("access_restricted") || body.includes("forbidden");
    throw new Error(
      isPolicy || isIPBlock
        ? `ML API bloqueada por IP do servidor (403). ` +
          `O IP da VM está bloqueado para buscas via API. ` +
          `Use busca via browser em mercadolivre.com.br como alternativa (ver AGENTS.md §Exec). ` +
          `Detalhe: ${body.slice(0, 200)}`
        : `ML API retornou 403. Token pode ter expirado ou não tem escopo para busca. ` +
          `Detalhe da resposta: ${body.slice(0, 300)}. ` +
          `Se for erro de IP/servidor, use o browser. Se for token, reexecute --setup.`
    );
  }

  if (!resp.ok) {
    throw new Error(`ML API retornou status ${resp.status}: ${await resp.text()}`);
  }

  const data: MLSearchResponse = await resp.json();
  return data.results ?? [];
}

// --- Main ---

async function main() {
  const opts = parseArgs();

  const appId = process.env.ML_APP_ID;
  const appSecret = process.env.ML_APP_SECRET;

  if (!appId || !appSecret) {
    console.error(JSON.stringify({
      error: "ML_APP_ID e ML_APP_SECRET são obrigatórios.",
      hint: "Defina as variáveis de ambiente e execute --setup para configurar o token.",
    }));
    process.exit(2);
  }

  // --- Modo setup: trocar code por tokens e salvar cache ---
  if (opts.mode === "setup") {
    let cache: TokenCache;
    try {
      cache = await exchangeCodeForTokens(appId, appSecret, opts.code, opts.redirectUri);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ error: `Falha no setup do token ML: ${message}` }));
      process.exit(2);
    }
    await writeTokenCache(cache);
    const expiresInMin = Math.round((cache.expires_at - Date.now()) / 60000);
    console.log(JSON.stringify({
      ok: true,
      message: `Token salvo em ${TOKEN_CACHE_PATH}`,
      expires_in_minutes: expiresInMin,
      has_refresh_token: true,
      note: "O token será renovado automaticamente nas próximas buscas.",
    }, null, 2));
    return;
  }

  // --- Modo busca ---
  let token: string;
  try {
    token = await getValidToken(appId, appSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error: `Falha ao obter token ML: ${message}` }));
    process.exit(2);
  }

  let items: MLSearchResult[];
  try {
    items = await searchML(opts.query, opts.limit, opts.maxPrice, token);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error: `Falha ao consultar ML API: ${message}` }));
    process.exit(2);
  }

  if (items.length === 0) {
    console.log(JSON.stringify({ query: opts.query, total: 0, results: [] }));
    return;
  }

  const withDelivery = items.map((item) => ({
    item,
    delivery: estimateDelivery(item),
  }));

  const deliveryOk = withDelivery.filter((x) => x.delivery.ok);
  const pool = deliveryOk.length >= 3 ? deliveryOk : withDelivery;

  const afterShipping = opts.freeShipping
    ? pool.filter((x) => x.item.shipping?.free_shipping)
    : pool;

  const afterOfficialStore = opts.officialStore
    ? afterShipping.filter((x) => x.item.official_store_id)
    : afterShipping;

  let afterRating = afterOfficialStore.filter(
    (x) => (x.item.reviews?.rating_average ?? 0) >= opts.minRating
  );
  if (afterRating.length < 3) {
    afterRating = afterOfficialStore.filter(
      (x) => (x.item.reviews?.rating_average ?? 0) >= 3.5
    );
  }
  const finalPool = afterRating.length > 0 ? afterRating : afterOfficialStore;

  const prices = finalPool.map((x) => x.item.price);
  const minPrice = Math.min(...prices);
  const maxPriceCalc = Math.max(...prices);
  const maxReviews = Math.max(...finalPool.map((x) => x.item.reviews?.total ?? 0));

  const ranked: RankedProduct[] = finalPool
    .map(({ item, delivery }) => ({
      rank: 0,
      id: item.id,
      title: item.title,
      price: item.price,
      currency: item.currency_id,
      condition: item.condition,
      rating: item.reviews?.rating_average ?? null,
      reviews_total: item.reviews?.total ?? null,
      free_shipping: item.shipping?.free_shipping ?? false,
      estimated_delivery: delivery.label,
      estimated_delivery_ok: delivery.ok,
      seller_type: sellerType(item),
      seller_name: item.official_store_name ?? item.seller?.nickname ?? "Desconhecido",
      permalink: item.permalink,
      score: calcScore(item, minPrice, maxPriceCalc, maxReviews),
    }))
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  console.log(
    JSON.stringify(
      {
        query: opts.query,
        total: ranked.length,
        filters_applied: {
          max_price: opts.maxPrice,
          min_rating: opts.minRating,
          free_shipping: opts.freeShipping,
          official_store: opts.officialStore,
        },
        results: ranked,
      },
      null,
      2
    )
  );
}

main();
