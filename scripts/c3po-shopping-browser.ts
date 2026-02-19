#!/usr/bin/env bun
/**
 * c3po-shopping-browser.ts — Busca produtos no ML e Amazon via Playwright headless.
 *
 * Contorna o bloqueio de IP que afeta a ML API em servidores de datacenter.
 * Retorna o mesmo formato JSON de c3po-shopping-ml.ts — drop-in replacement.
 *
 * USO:
 *   bun scripts/c3po-shopping-browser.ts --query "liquidificador"
 *   bun scripts/c3po-shopping-browser.ts --query "fone bluetooth" --source amazon --max-price 200
 *   bun scripts/c3po-shopping-browser.ts --query "tapete yoga" --source both --min-rating 4.0 --limit 10
 *
 * FLAGS:
 *   --query       Termo de busca (obrigatório)
 *   --source      ml | amazon | both (padrão: both)
 *   --max-price   Preço máximo em R$ (filtragem client-side após raspagem)
 *   --min-rating  Avaliação mínima em estrelas (padrão: 4.0, fallback para 3.5)
 *   --free-shipping  Filtrar apenas frete grátis
 *   --official-store  ML: filtrar apenas Lojas Oficiais
 *   --limit       Máximo de resultados por fonte (padrão: 10, máx: 30)
 *
 * PRÉ-REQUISITO na VM:
 *   npm install -g playwright && npx playwright install chromium
 *   (executado automaticamente pelo deploy/exe-dev-setup.sh)
 */

import { chromium, type Browser, type Page } from "playwright";

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

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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

// ─── ML Scraper ───────────────────────────────────────────────────────────────

async function searchML(
  page: Page,
  query: string,
  limit: number
): Promise<RawProduct[]> {
  const url = `https://www.mercadolivre.com.br/busca?as_word=${encodeURIComponent(query)}&sort=price_asc`;

  await page.goto(url, { waitUntil: "load", timeout: 30_000 });

  // Detectar bloqueio / CAPTCHA
  const isCaptcha = await page
    .locator("#recaptcha, .g-recaptcha, form[action*='captcha']")
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  const isBlocked = await page
    .locator("text=Você foi bloqueado, text=acesso negado")
    .isVisible({ timeout: 2_000 })
    .catch(() => false);

  if (isCaptcha || isBlocked) {
    throw new Error(
      "ML retornou página de CAPTCHA ou bloqueio. Use o browser tool do OpenClaw como fallback."
    );
  }

  // Aguardar resultados renderizarem (ML usa React/SSR) — selectors cobrem UI clássica e poly-ui
  await page
    .waitForSelector(
      "li.ui-search-layout__item, .poly-card, .ui-search-results li, [class*='ui-search-layout__item']",
      { timeout: 20_000 }
    )
    .catch(() => {
      throw new Error("ML não exibiu resultados no tempo esperado — possível bloqueio ou mudança de layout.");
    });

  // Pequena pausa para lazy-loaded ratings
  await page.waitForTimeout(1_500);

  const raw = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("li.ui-search-layout__item"));

    return items.map((item) => {
      // Título
      const titleEl = item.querySelector(
        "a.poly-component__title, h2.poly-box, .ui-search-item__title, .poly-box"
      );
      const title = titleEl?.textContent?.trim() ?? "";

      // Preço (poly-ui novo + fallback clássico)
      const fractionEl = item.querySelector(
        ".poly-price__current .andes-money-amount__fraction, " +
        ".ui-search-price__second-line .andes-money-amount__fraction, " +
        ".price-tag-fraction"
      );
      const centsEl = item.querySelector(
        ".poly-price__current .andes-money-amount__cents, " +
        ".ui-search-price__second-line .andes-money-amount__cents, " +
        ".price-tag-cents"
      );
      const priceText = fractionEl
        ? (fractionEl.textContent ?? "") + "," + (centsEl?.textContent ?? "00")
        : "";

      // Rating
      const ratingEl = item.querySelector(
        ".poly-reviews__rating, .ui-search-reviews__rating-number"
      );
      const ratingText = ratingEl?.textContent?.trim() ?? "";

      // Número de avaliações
      const reviewsEl = item.querySelector(
        ".poly-reviews__total, .ui-search-reviews__amount"
      );
      const reviewsText = reviewsEl?.textContent?.trim() ?? "";

      // Frete grátis
      const shippingEl = item.querySelector(
        ".poly-component__shipping, .ui-search-item__shipping-label, " +
        "[class*='shipping'], .ui-search-fulfillment-badge__title"
      );
      const shippingText = shippingEl?.textContent?.toLowerCase() ?? "";
      const free_shipping =
        shippingText.includes("grátis") || shippingText.includes("gratis") || shippingText.includes("full");

      // Loja Oficial
      const officialStoreEl = item.querySelector(
        ".poly-component__seller-info--official-store, " +
        ".ui-search-item__store-logo-container, " +
        "[class*='official-store']"
      );
      const isOfficialStore = !!officialStoreEl;

      // Power seller (badge MercadoLíder)
      const badgeEl = item.querySelector(
        ".poly-component__seller-info, [class*='power-seller'], [class*='mercado-lider']"
      );
      const badgeText = badgeEl?.textContent?.toLowerCase() ?? "";
      const isPlatinum = badgeText.includes("platina");
      const isGold = badgeText.includes("ouro");
      const isSilver = badgeText.includes("prata");

      const seller_type = isOfficialStore
        ? "official_store"
        : isPlatinum
          ? "mercadolider_platinum"
          : isGold
            ? "mercadolider_gold"
            : isSilver
              ? "mercadolider_silver"
              : "regular";

      // Nome do seller
      const sellerNameEl = item.querySelector(
        ".poly-component__seller, .ui-search-item__store-logo-container img, " +
        "[class*='seller-name'], [class*='store-name']"
      );
      const seller_name =
        sellerNameEl?.textContent?.trim() ||
        (sellerNameEl as HTMLImageElement | null)?.alt ||
        "Vendedor ML";

      // Link
      const linkEl = item.querySelector(
        "a.poly-component__title, a.ui-search-item__group__element, a[href*='mercadolivre']"
      );
      const permalink = (linkEl as HTMLAnchorElement | null)?.href ?? "";

      // Condição (novo / usado)
      const conditionEl = item.querySelector(
        ".poly-attributes-list__item, .ui-search-item__condition"
      );
      const conditionText = conditionEl?.textContent?.toLowerCase() ?? "";
      const condition = conditionText.includes("usado") ? "used" : "new";

      return {
        title,
        priceText,
        ratingText,
        reviewsText,
        free_shipping,
        seller_type,
        seller_name,
        permalink,
        condition,
      };
    });
  });

  return raw
    .filter((p) => p.title && p.priceText)
    .map((p) => {
      const price = parsePrice(p.priceText);
      if (!price) return null;

      return {
        source: "ml" as const,
        title: p.title,
        price,
        rating: parseRating(p.ratingText),
        reviews_total: parseReviews(p.reviewsText),
        free_shipping: p.free_shipping,
        seller_name: p.seller_name,
        seller_type: p.seller_type as RawProduct["seller_type"],
        permalink: p.permalink,
        condition: p.condition as "new" | "used",
      };
    })
    .filter((p): p is RawProduct => p !== null)
    .slice(0, limit);
}

// ─── Amazon Scraper ───────────────────────────────────────────────────────────

async function searchAmazon(
  page: Page,
  query: string,
  limit: number
): Promise<RawProduct[]> {
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(query)}&s=price-asc-rank`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Detectar CAPTCHA Amazon
  const isCaptcha = await page
    .locator("form[action='/errors/validateCaptcha'], text=Digite os caracteres")
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  if (isCaptcha) {
    throw new Error(
      "Amazon retornou CAPTCHA. Use o browser tool do OpenClaw como fallback."
    );
  }

  await page
    .waitForSelector("[data-component-type='s-search-result']", { timeout: 15_000 })
    .catch(() => {
      throw new Error(
        "Amazon não exibiu resultados no tempo esperado — possível CAPTCHA ou mudança de layout."
      );
    });

  await page.waitForTimeout(1_000);

  const raw = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll("[data-component-type='s-search-result']")
    ).filter((el) => !el.querySelector(".puis-sponsored-label-text"));

    return items.map((item) => {
      // Título
      const titleEl = item.querySelector("h2 a span, h2 span.a-text-normal");
      const title = titleEl?.textContent?.trim() ?? "";

      // Preço
      const wholeEl = item.querySelector(".a-price .a-price-whole");
      const fracEl = item.querySelector(".a-price .a-price-fraction");
      const priceText = wholeEl
        ? (wholeEl.textContent ?? "").replace(".", "") + "," + (fracEl?.textContent ?? "00")
        : "";

      // Rating
      const ratingEl = item.querySelector(".a-icon-alt");
      const ratingText = ratingEl?.textContent?.trim() ?? "";

      // Avaliações
      const reviewsEl = item.querySelector(
        "span.a-size-base.s-underline-text, span.a-size-base[aria-label*='classificações']"
      );
      const reviewsText = reviewsEl?.textContent?.trim() ?? "";

      // Frete / Prime
      const primeEl = item.querySelector("[aria-label*='Prime'], .a-icon-prime");
      const freeEl = item.querySelector(".a-color-success");
      const freeText = freeEl?.textContent?.toLowerCase() ?? "";
      const free_shipping =
        !!primeEl ||
        freeText.includes("grátis") ||
        freeText.includes("gratis");

      // Seller
      const sellerEl = item.querySelector(
        "span.a-size-small .a-color-secondary, .s-merchant-info a"
      );
      const sellerText = sellerEl?.textContent?.trim() ?? "";
      const seller_name = sellerText || (!!primeEl ? "Amazon.com.br" : "Vendedor Amazon");

      // Link
      const linkEl = item.querySelector("h2 a[href]");
      const href = (linkEl as HTMLAnchorElement | null)?.getAttribute("href") ?? "";
      const permalink = href.startsWith("http")
        ? href
        : "https://www.amazon.com.br" + href;

      return { title, priceText, ratingText, reviewsText, free_shipping, seller_name, permalink };
    });
  });

  return raw
    .filter((p) => p.title && p.priceText)
    .map((p) => {
      const price = parsePrice(p.priceText);
      if (!price) return null;

      return {
        source: "amazon" as const,
        title: p.title,
        price,
        rating: parseRating(p.ratingText),
        reviews_total: parseReviews(p.reviewsText),
        free_shipping: p.free_shipping,
        seller_name: p.seller_name,
        seller_type: "regular" as const,
        permalink: p.permalink,
        condition: "new" as const,
      };
    })
    .filter((p): p is RawProduct => p !== null)
    .slice(0, limit);
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

  // Preferir proxy RapidAPI (contorna bloqueio de datacenter)
  if (rapidApiKey) {
    const res = await fetch(
      `https://mercado-libre7.p.rapidapi.com/sites/MLB/search?${params}`,
      {
        headers: {
          "X-RapidAPI-Key": rapidApiKey,
          "X-RapidAPI-Host": "mercado-libre7.p.rapidapi.com",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) throw new Error(`ML RapidAPI HTTP ${res.status}`);
    const data = (await res.json()) as { results: MLApiItem[] };
    return mapMLItems(data.results, limit);
  }

  // Fallback: API oficial direta (só funciona fora de datacenter)
  const res = await fetch(
    `https://api.mercadolibre.com/sites/MLB/search?${params}`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) throw new Error(`ML API HTTP ${res.status}`);
  const data = (await res.json()) as { results: MLApiItem[] };
  return mapMLItems(data.results, limit);
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY ?? "";

  const raw: RawProduct[] = [];
  const warnings: { source: string; error: string }[] = [];

  // ─── Fase 1: API (rápida, sem browser) ──────────────────────────────────────

  if (opts.source === "ml" || opts.source === "both") {
    try {
      const results = await searchMLViaApi(opts.query, opts.limit, opts.maxPrice, RAPIDAPI_KEY);
      raw.push(...results);
    } catch (err: unknown) {
      warnings.push({ source: "ml-api", error: String(err) });
    }
  }

  if (opts.source === "amazon" || opts.source === "both") {
    if (RAPIDAPI_KEY) {
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

  // ─── Fase 2: Browser (fallback — só para fontes sem resultados via API) ──────

  const needsBrowserML =
    (opts.source === "ml" || opts.source === "both") &&
    !raw.some((r) => r.source === "ml");
  const needsBrowserAmazon =
    (opts.source === "amazon" || opts.source === "both") &&
    !raw.some((r) => r.source === "amazon");

  let browser: Browser | null = null;
  try {
    if (needsBrowserML || needsBrowserAmazon) {
      browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
        ],
      });

      const context = await browser.newContext({
        userAgent: USER_AGENT,
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        viewport: { width: 1280, height: 800 },
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      await context.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (["image", "media", "font"].includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      if (needsBrowserML) {
        const page = await context.newPage();
        try {
          const results = await searchML(page, opts.query, opts.limit);
          raw.push(...results);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push({ source: "ml", error: msg });
        } finally {
          await page.close();
        }
      }

      if (needsBrowserAmazon) {
        const page = await context.newPage();
        try {
          const results = await searchAmazon(page, opts.query, opts.limit);
          raw.push(...results);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push({ source: "amazon", error: msg });
        } finally {
          await page.close();
        }
      }

      await context.close();
    }
  } finally {
    if (browser) await browser.close();
  }

  // ─── Nenhum resultado + todos com erro → falha total ────────────────────────

  if (raw.length === 0 && warnings.length > 0) {
    const errorMsg = warnings.map((w) => `${w.source}: ${w.error}`).join(" | ");
    console.error(
      JSON.stringify({
        error: `Nenhum resultado obtido. ${errorMsg}`,
        fallback_hint:
          "Use o browser tool do OpenClaw diretamente: browser navigate + browser snapshot.",
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
    .slice(0, opts.limit)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  console.log(
    JSON.stringify(
      {
        query: opts.query,
        total: ranked.length,
        sources: [...new Set(ranked.map((p) => p.source))],
        filters_applied: {
          max_price: opts.maxPrice,
          min_rating: opts.minRating,
          free_shipping: opts.freeShipping,
          official_store: opts.officialStore,
        },
        results: ranked,
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
