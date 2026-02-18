#!/usr/bin/env bun
/**
 * c3po-shopping-ml.ts — Busca e ranqueia produtos no Mercado Livre (Brasil).
 *
 * Usa a API pública do Mercado Livre (site MLB) — sem autenticação necessária.
 *
 * Uso básico:
 *   bun scripts/c3po-shopping-ml.ts --query "liquidificador mondial"
 *
 * Com filtros:
 *   bun scripts/c3po-shopping-ml.ts \
 *     --query "liquidificador mondial" \
 *     --max-price 200 \
 *     --min-rating 4.0 \
 *     --free-shipping \
 *     --official-store \
 *     --limit 20
 *
 * Saída: JSON com array "results" de produtos ranqueados por score.
 */

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

// --- Parsing de args ---

function parseArgs(): {
  query: string;
  maxPrice: number | null;
  minRating: number;
  freeShipping: boolean;
  officialStore: boolean;
  limit: number;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const query = get("--query");
  if (!query) {
    console.error(JSON.stringify({ error: "Parâmetro --query é obrigatório." }));
    process.exit(1);
  }

  return {
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

  // Fulfillment = ML armazena o produto → entrega rápida
  if (logistic === "fulfillment") {
    return { label: "≤3 dias", ok: true };
  }

  // Drop-off com bom seller
  if (logistic === "xd_drop_off") {
    if (powerSeller === "platinum" || powerSeller === "gold") {
      return { label: "≤5 dias", ok: true };
    }
    return { label: "≤7 dias", ok: true };
  }

  // Cross-docking
  if (logistic === "cross_docking") {
    if (powerSeller === "platinum" || powerSeller === "gold") {
      return { label: "≤7 dias", ok: true };
    }
    if (powerSeller === "silver") {
      return { label: "≤12 dias", ok: true };
    }
    return { label: "≤12 dias", ok: true };
  }

  // Seller sem reputação ou logística desconhecida
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
  // Preço (35%): quanto menor em relação ao max do conjunto, maior a pontuação
  const priceRange = maxPrice - minPrice;
  const priceScore = priceRange > 0
    ? 1 - (item.price - minPrice) / priceRange
    : 1;

  // Rating (25%)
  const rating = item.reviews?.rating_average ?? 0;
  const ratingScore = rating / 5;

  // Nº de avaliações — confiança (15%)
  const reviewsTotal = item.reviews?.total ?? 0;
  const reviewsScore = maxReviews > 0
    ? Math.log10(reviewsTotal + 1) / Math.log10(maxReviews + 1)
    : 0;

  // Frete (15%)
  const shippingScore = item.shipping?.free_shipping ? 1.0 : 0.3;

  // Seller (10%)
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

  return Math.round(total * 100 * 10) / 10; // 0–100, 1 decimal
}

// --- Autenticação ML (client credentials) ---

async function getAppToken(appId: string, appSecret: string): Promise<string> {
  const resp = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Falha ao obter token ML: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

// --- Busca na API do ML ---

async function searchML(
  query: string,
  limit: number,
  maxPriceParam: number | null,
  token?: string
): Promise<MLSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    sort: "price_asc",
    limit: String(limit),
    ...(maxPriceParam ? { price: `*-${maxPriceParam}` } : {}),
  });

  const url = `https://api.mercadolibre.com/sites/MLB/search?${params}`;

  const headers: Record<string, string> = {
    "User-Agent": "c3po-family-agent/1.0",
    "Accept": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const resp = await fetch(url, { headers });

  if (resp.status === 403) {
    const hint = token
      ? "Token inválido ou expirado."
      : "Configure ML_APP_ID e ML_APP_SECRET no ambiente para autenticação.";
    throw new Error(`ML API bloqueou a requisição (403). ${hint}`);
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

  // A API de busca do ML é pública — não requer token
  let items: MLSearchResult[];
  try {
    items = await searchML(opts.query, opts.limit, opts.maxPrice);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error: `Falha ao consultar ML API: ${message}` }));
    process.exit(2);
  }

  if (items.length === 0) {
    console.log(JSON.stringify({ query: opts.query, total: 0, results: [] }));
    return;
  }

  // Filtrar por prazo de entrega (descartar prazo incerto se não for seller qualificado)
  const withDelivery = items.map((item) => ({
    item,
    delivery: estimateDelivery(item),
  }));

  const deliveryOk = withDelivery.filter((x) => x.delivery.ok);

  // Se filtrar demais, relaxar e incluir "⚠️ prazo incerto" também
  const pool = deliveryOk.length >= 3 ? deliveryOk : withDelivery;

  // Filtrar por frete grátis (se solicitado)
  const afterShipping = opts.freeShipping
    ? pool.filter((x) => x.item.shipping?.free_shipping)
    : pool;

  // Filtrar por Loja Oficial (se solicitado)
  const afterOfficialStore = opts.officialStore
    ? afterShipping.filter((x) => x.item.official_store_id)
    : afterShipping;

  // Filtrar por rating mínimo (relaxar se necessário)
  let afterRating = afterOfficialStore.filter(
    (x) => (x.item.reviews?.rating_average ?? 0) >= opts.minRating
  );
  if (afterRating.length < 3) {
    // Relaxar para 3.5
    afterRating = afterOfficialStore.filter(
      (x) => (x.item.reviews?.rating_average ?? 0) >= 3.5
    );
  }
  // Se ainda não houver resultados suficientes, usar tudo
  const finalPool = afterRating.length > 0 ? afterRating : afterOfficialStore;

  // Calcular score
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
