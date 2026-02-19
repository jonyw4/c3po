#!/usr/bin/env bun
/**
 * c3po-shopping-browser.ts — Busca produtos no ML e Amazon via APIs (sem browser).
 *
 * ML:     mercado-libre7.p.rapidapi.com (RAPIDAPI_KEY obrigatório)
 * Amazon: real-time-amazon-data.p.rapidapi.com (RAPIDAPI_KEY obrigatório)
 * LLM:    Filtro de relevância via claude-haiku (ANTHROPIC_API_KEY opcional)
 *
 * USO:
 *   bun scripts/c3po-shopping-browser.ts --query "liquidificador"
 *   bun scripts/c3po-shopping-browser.ts --query "fone bluetooth" --source amazon --max-price 200
 *   bun scripts/c3po-shopping-browser.ts --query "tapete yoga" --source both --min-rating 4.0 --limit 10
 *
 * FLAGS:
 *   --query          Termo de busca (obrigatório)
 *   --source         ml | amazon | both (padrão: both)
 *   --max-price      Preço máximo em R$
 *   --min-rating     Avaliação mínima em estrelas (padrão: 4.0, fallback para 3.5)
 *   --free-shipping  Filtrar apenas frete grátis
 *   --official-store ML: filtrar apenas Lojas Oficiais
 *   --limit          Máximo de resultados por fonte (padrão: 10, máx: 30)
 *
 * ENV:
 *   RAPIDAPI_KEY      — chave RapidAPI (obrigatório para qualquer busca)
 *   ANTHROPIC_API_KEY — chave Anthropic para filtro de relevância (opcional)
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RawProduct {
  source: "ml" | "amazon";
  title: string;
  price: number;
  rating: number | null;
  reviews_total: number | null;
  free_shipping: boolean;
  seller_name: string;
  seller_type:
    | "official_store"
    | "mercadolider_platinum"
    | "mercadolider_gold"
    | "mercadolider_silver"
    | "regular";
  permalink: string;
  condition: "new" | "used";
}

interface RankedProduct {
  rank: number;
  source: "ml" | "amazon";
  title: string;
  price: number;
  currency: string;
  condition: string;
  rating: number | null;
  reviews_total: number | null;
  free_shipping: boolean;
  estimated_delivery: string;
  seller_type: string;
  seller_name: string;
  permalink: string;
  score: number;
}

// ─── Args ─────────────────────────────────────────────────────────────────────

interface Args {
  query: string;
  source: "ml" | "amazon" | "both";
  maxPrice: number | null;
  minRating: number;
  freeShipping: boolean;
  officialStore: boolean;
  limit: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const query = get("--query");
  if (!query) {
    console.error(
      JSON.stringify({
        error: "Parâmetro --query é obrigatório.",
        exemplo: 'bun scripts/c3po-shopping-browser.ts --query "liquidificador" --max-price 200',
      })
    );
    process.exit(1);
  }

  const sourceArg = get("--source") ?? "both";
  if (!["ml", "amazon", "both"].includes(sourceArg)) {
    console.error(JSON.stringify({ error: "--source deve ser ml, amazon ou both." }));
    process.exit(1);
  }

  return {
    query,
    source: sourceArg as "ml" | "amazon" | "both",
    maxPrice: get("--max-price") ? Number(get("--max-price")) : null,
    minRating: get("--min-rating") ? Number(get("--min-rating")) : 4.0,
    freeShipping: has("--free-shipping"),
    officialStore: has("--official-store"),
    limit: get("--limit") ? Math.min(Number(get("--limit")), 30) : 10,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePrice(text: string): number | null {
  // Aceita: "1.299,90" / "1.299" / "299,90" / "1299.90"
  const cleaned = text.replace(/[^\d,\.]/g, "").trim();
  if (!cleaned) return null;
  // Formato BR: ponto = separador de milhar, vírgula = decimal
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}

function parseRating(text: string): number | null {
  const normalized = text.replace(",", ".").trim();
  const match = normalized.match(/[\d.]+/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return isNaN(n) ? null : n;
}

function parseReviews(text: string): number | null {
  const cleaned = text.replace(/[()]/g, "").trim();
  if (!cleaned) return null;
  if (cleaned.toLowerCase().includes("mil")) {
    const n = parseFloat(cleaned.replace(/mil/i, "").trim().replace(",", "."));
    return isNaN(n) ? null : Math.round(n * 1000);
  }
  const n = parseInt(cleaned.replace(/\./g, ""), 10);
  return isNaN(n) ? null : n;
}

// ─── Score ponderado ──────────────────────────────────────────────────────────
// Peso: preço 35%, rating 25%, nº avaliações 15%, frete grátis 15%, seller 10%

function calcScore(
  p: RawProduct,
  minPrice: number,
  maxPrice: number,
  maxReviews: number
): number {
  const priceRange = maxPrice - minPrice;
  const priceScore = priceRange > 0 ? 1 - (p.price - minPrice) / priceRange : 1;
  const ratingScore = (p.rating ?? 0) / 5;
  const reviews = p.reviews_total ?? 0;
  const reviewsScore =
    maxReviews > 0 ? Math.log10(reviews + 1) / Math.log10(maxReviews + 1) : 0;
  const shippingScore = p.free_shipping ? 1.0 : 0.3;
  const sellerScore =
    p.seller_type === "official_store"
      ? 1.0
      : p.seller_type === "mercadolider_platinum"
        ? 0.9
        : p.seller_type === "mercadolider_gold"
          ? 0.8
          : p.seller_type === "mercadolider_silver"
            ? 0.6
            : 0.4;

  const total =
    priceScore * 0.35 +
    ratingScore * 0.25 +
    reviewsScore * 0.15 +
    shippingScore * 0.15 +
    sellerScore * 0.1;

  return Math.round(total * 100 * 10) / 10;
}

function estimateDelivery(p: RawProduct): string {
  if (p.source === "amazon") {
    return p.seller_name.toLowerCase().includes("amazon") ? "≤3 dias" : "≤7 dias";
  }
  if (
    p.seller_type === "official_store" ||
    p.seller_type === "mercadolider_platinum"
  )
    return "≤3 dias";
  if (p.seller_type === "mercadolider_gold") return "≤5 dias";
  if (p.seller_type === "mercadolider_silver") return "≤10 dias";
  return "≤15 dias";
}


// ─── ML via API (RapidAPI proxy ou oficial) ───────────────────────────────────
// Com RAPIDAPI_KEY: usa mercado-libre7.p.rapidapi.com (evita bloqueio de datacenter)
// Sem key: tenta api.mercadolibre.com diretamente (funciona em IPs residenciais)

interface MLApiItem {
  title: string;
  price: number;
  condition: string;
  permalink: string;
  shipping: { free_shipping: boolean };
  official_store_id: number | null;
  seller: { id: number; nickname: string };
}

function mapMLItems(results: MLApiItem[], limit: number): RawProduct[] {
  return (results ?? [])
    .filter((r) => r.price > 0 && r.title)
    .map(
      (r): RawProduct => ({
        source: "ml",
        title: r.title,
        price: r.price,
        rating: null, // não disponível no endpoint público de busca
        reviews_total: null,
        free_shipping: r.shipping?.free_shipping ?? false,
        seller_name: r.seller?.nickname ?? "Vendedor ML",
        seller_type: r.official_store_id ? "official_store" : "regular",
        permalink: r.permalink,
        condition: r.condition === "used" ? "used" : "new",
      })
    )
    .slice(0, limit);
}

async function searchMLViaApi(
  query: string,
  limit: number,
  maxPrice: number | null,
  rapidApiKey: string
): Promise<RawProduct[]> {
  const params = new URLSearchParams({
    q: query,
    sort: "price_asc",
    limit: String(Math.min(limit * 3, 50)),
  });
  if (maxPrice !== null) params.set("price_to", String(maxPrice));

  if (!rapidApiKey) {
    throw new Error("RAPIDAPI_KEY não configurado — ML ignorado.");
  }

  const rapidHeaders = {
    "X-RapidAPI-Key": rapidApiKey,
    "X-RapidAPI-Host": "mercado-libre7.p.rapidapi.com",
    Accept: "application/json",
  };

  // Tenta paths em ordem de probabilidade para a mercado-libre7 RapidAPI
  const mlPaths = [
    `https://mercado-libre7.p.rapidapi.com/listings_from_search?q=${encodeURIComponent(query)}&site_id=MLB&limit=${Math.min(limit * 3, 50)}${params.get("price_to") ? `&max_price=${params.get("price_to")}` : ""}`,
    `https://mercado-libre7.p.rapidapi.com/sites/MLB/search?${params}`,
    `https://mercado-libre7.p.rapidapi.com/search?site_id=MLB&${params}`,
  ];

  for (const path of mlPaths) {
    const res = await fetch(path, {
      headers: rapidHeaders,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`ML RapidAPI HTTP ${res.status} em ${path}`);
    const data = (await res.json()) as { results: MLApiItem[] };
    return mapMLItems(data.results, limit);
  }
  throw new Error("ML RapidAPI: nenhum endpoint respondeu (404 em todos os paths)");
}

// ─── Amazon via Real-Time Amazon Data (RapidAPI – letscrape) ─────────────────

interface AmazonApiProduct {
  product_title: string;
  product_price: string;
  product_star_rating: string;
  product_num_ratings: number;
  product_url: string;
  delivery: string;
  is_prime: boolean;
}

async function searchAmazonViaApi(
  query: string,
  limit: number,
  rapidApiKey: string,
  maxPrice: number | null,
  minRating: number
): Promise<RawProduct[]> {
  const params = new URLSearchParams({
    query,
    country: "BR",
    sort_by: "LOWEST_PRICE",
    page: "1",
  });
  if (maxPrice !== null) params.set("max_price", String(maxPrice));
  if (minRating > 0) params.set("min_rating", String(minRating));

  const res = await fetch(
    `https://real-time-amazon-data.p.rapidapi.com/search?${params}`,
    {
      headers: {
        "X-RapidAPI-Key": rapidApiKey,
        "X-RapidAPI-Host": "real-time-amazon-data.p.rapidapi.com",
      },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) throw new Error(`Amazon API HTTP ${res.status}`);

  const data = (await res.json()) as {
    data: { products: AmazonApiProduct[] };
  };
  const products = data.data?.products ?? [];

  return products
    .filter((p) => p.product_title && p.product_price)
    .map((p): RawProduct | null => {
      const price = parsePrice(p.product_price);
      if (!price) return null;

      const deliveryLc = (p.delivery ?? "").toLowerCase();
      const free_shipping =
        p.is_prime ||
        deliveryLc.includes("grátis") ||
        deliveryLc.includes("gratis") ||
        deliveryLc.includes("free");

      return {
        source: "amazon",
        title: p.product_title,
        price,
        rating: p.product_star_rating ? parseFloat(p.product_star_rating) : null,
        reviews_total: p.product_num_ratings || null,
        free_shipping,
        seller_name: p.is_prime ? "Amazon.com.br" : "Vendedor Amazon",
        seller_type: "regular",
        permalink: p.product_url,
        condition: "new",
      };
    })
    .filter((p): p is RawProduct => p !== null)
    .slice(0, limit);
}

// ─── Filtro de relevância via LLM ────────────────────────────────────────────
// Remove acessórios, peças e itens não relacionados à busca principal.
// Requer ANTHROPIC_API_KEY; sem a chave, retorna todos os produtos.

async function filterByRelevance(
  products: RankedProduct[],
  query: string,
  apiKey: string
): Promise<RankedProduct[]> {
  if (products.length === 0 || !apiKey) return products;

  const list = products.map((p, i) => `${i}: ${p.title} — R$${p.price}`).join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content:
              `Busca do usuário: "${query}"\n\n` +
              `Produtos encontrados:\n${list}\n\n` +
              `Quais desses produtos (pelos índices) SÃO realmente o que o usuário buscou e NÃO são peças, acessórios, tampas, correias, adaptadores, kits de reparo ou itens meramente relacionados? ` +
              `Responda SOMENTE com um array JSON de índices válidos, sem texto extra. Exemplo: [0, 2, 4]`,
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return products;

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = data.content?.[0]?.text ?? "";
    const match = text.match(/\[[\d,\s]*\]/);
    if (!match) return products;

    const indexes = (JSON.parse(match[0]) as number[]).filter(
      (i) => i >= 0 && i < products.length
    );
    const filtered = indexes.map((i) => products[i]);
    return filtered.length > 0 ? filtered : products;
  } catch {
    return products; // nunca bloqueia — falha silenciosa
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY ?? "";

  const raw: RawProduct[] = [];
  const warnings: { source: string; error: string }[] = [];

  // ─── Busca via API ───────────────────────────────────────────────────────────

  if (opts.source === "ml" || opts.source === "both") {
    try {
      const results = await searchMLViaApi(opts.query, opts.limit, opts.maxPrice, RAPIDAPI_KEY);
      raw.push(...results);
    } catch (err: unknown) {
      warnings.push({ source: "ml-api", error: String(err) });
    }
  }

  if (opts.source === "amazon" || opts.source === "both") {
    if (!RAPIDAPI_KEY) {
      warnings.push({ source: "amazon-api", error: "RAPIDAPI_KEY não configurado — Amazon ignorado." });
    } else {
      try {
        const results = await searchAmazonViaApi(
          opts.query,
          opts.limit,
          RAPIDAPI_KEY,
          opts.maxPrice,
          opts.minRating
        );
        raw.push(...results);
      } catch (err: unknown) {
        warnings.push({ source: "amazon-api", error: String(err) });
      }
    }
  }

  // ─── Nenhum resultado + todos com erro → falha total ────────────────────────

  if (raw.length === 0 && warnings.length > 0) {
    const errorMsg = warnings.map((w) => `${w.source}: ${w.error}`).join(" | ");
    console.error(
      JSON.stringify({
        error: `Nenhum resultado obtido. Configure RAPIDAPI_KEY e tente novamente. Detalhes: ${errorMsg}`,
      })
    );
    process.exit(2);
  }

  // ─── Filtros ─────────────────────────────────────────────────────────────────

  let pool = opts.maxPrice !== null
    ? raw.filter((p) => p.price <= opts.maxPrice!)
    : raw;

  if (opts.freeShipping) pool = pool.filter((p) => p.free_shipping);
  if (opts.officialStore) pool = pool.filter((p) => p.seller_type === "official_store");

  // Rating com fallback progressivo (ML via API não retorna rating — incluir sem filtrar)
  let withRating = pool.filter((p) => (p.rating ?? 0) >= opts.minRating);
  if (withRating.length < 3) {
    withRating = pool.filter((p) => (p.rating ?? 0) >= 3.5);
  }
  const finalPool = withRating.length > 0 ? withRating : pool;

  if (finalPool.length === 0) {
    console.log(
      JSON.stringify({
        query: opts.query,
        total: 0,
        results: [],
        ...(warnings.length ? { warnings } : {}),
      })
    );
    return;
  }

  // ─── Ranking ─────────────────────────────────────────────────────────────────

  const prices = finalPool.map((p) => p.price);
  const minPrice = Math.min(...prices);
  const maxPriceCalc = Math.max(...prices);
  const maxReviews = Math.max(...finalPool.map((p) => p.reviews_total ?? 0));

  const ranked: RankedProduct[] = finalPool
    .map((p) => ({
      rank: 0,
      source: p.source,
      title: p.title,
      price: p.price,
      currency: "BRL",
      condition: p.condition,
      rating: p.rating,
      reviews_total: p.reviews_total,
      free_shipping: p.free_shipping,
      estimated_delivery: estimateDelivery(p),
      seller_type: p.seller_type,
      seller_name: p.seller_name,
      permalink: p.permalink,
      score: calcScore(p, minPrice, maxPriceCalc, maxReviews),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit);

  // Filtro de relevância via LLM (remove peças/acessórios não relacionados)
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
  const relevant = await filterByRelevance(ranked, opts.query, ANTHROPIC_API_KEY);
  const final = relevant.map((p, i) => ({ ...p, rank: i + 1 }));

  console.log(
    JSON.stringify(
      {
        query: opts.query,
        total: final.length,
        sources: [...new Set(final.map((p) => p.source))],
        filters_applied: {
          max_price: opts.maxPrice,
          min_rating: opts.minRating,
          free_shipping: opts.freeShipping,
          official_store: opts.officialStore,
        },
        results: final,
        ...(warnings.length ? { warnings } : {}),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err) }));
  process.exit(2);
});
