# RFC 0002 — Skill de Comparação de Compras (Mercado Livre + Amazon)

- **Status:** Proposto
- **Data:** 2026-02-18
- **Owner:** família Nunes-Célio

---

## 1) Propósito

Criar uma skill chamada `shopping-comparison` que permita ao C3PO realizar pesquisas iterativas de produtos no **Mercado Livre** e na **Amazon Brasil**, refinando as buscas em loop de acordo com as respostas do casal, até chegar em no máximo **5 opções de compra** bem curadas.

A comparação é essencialmente textual: preço, frete, avaliação, seller e link — sem automação de compra.

---

## 2) Escopo

### O que a skill faz

- Pesquisar produtos simultaneamente no Mercado Livre (MLB) e Amazon Brasil
- Filtrar resultados por critérios de qualidade (preço, frete, avaliação)
- Apresentar um resumo textual comparativo no WhatsApp
- Iterar em loop com o casal para refinar a busca
- Encerrar com no máximo 5 opções finais

### O que a skill NÃO faz

- Finalizar compras (scope proibido pelo `AGENTS.md`)
- Comparar preços em outros marketplaces (Shopee, Americanas, etc.)
- Acessar contas do casal em nenhuma das plataformas
- Salvar histórico de pesquisas permanentemente (somente `memory/`)

---

## 3) Fluxo de Interação

```
Pedido do casal (ex: "c3po, me ajuda a comprar um liquidificador")
        |
  1. ENTENDER — Clarificar produto, orçamento, preferências mínimas
        |
  2. BUSCAR — Pesquisar ML + Amazon com os termos definidos
        |
  3. APRESENTAR — Mostrar 3–8 opções com score resumido
        |
  4. REFINAR? — Casal decide: refinar busca OU parar
        |      \
        |    [parar] → FINALIZAR: top 5 opções comparadas
        |
     [refinar] → volta a BUSCAR com novos termos/filtros
```

Máximo de **rodadas de refinamento: sem limite**, mas a cada rodada o número de opções apresentadas vai diminuindo até restar ≤ 5 finais.

---

## 4) Fluxo Detalhado

### 4.1 ENTENDER

- Se o pedido for vago (ex: "liquidificador"), perguntar (máximo 2–3 perguntas):
  - Orçamento aproximado?
  - Tem marca preferida?
  - Algum requisito técnico (potência, capacidade, etc.)?
- Se o pedido já for específico (ex: "liquidificador Mondial 900W até R$150"), pular direto para BUSCAR.

### 4.2 BUSCAR

**Mercado Livre** via script TypeScript (`scripts/c3po-shopping-ml.ts`):
- Endpoint público (sem auth): `GET https://api.mercadolibre.com/sites/MLB/search`
- Parâmetros principais:
  - `q` — termo de busca
  - `sort=price_asc` — menor preço primeiro
  - `limit=20` — até 20 resultados por página
- Filtros aplicados no pós-processamento:
  - `reviews.rating_average >= 4.0` (se disponível)
  - `shipping.free_shipping == true` (preferência, não eliminatório)
  - `official_store_id != null` (preferência, não eliminatório)
  - Reputação do seller: `power_seller_status` in `["gold", "platinum"]` ou tag `good_seller`
- Estimativa de prazo de entrega: inferida pelo `shipping.logistic_type` e reputação do seller (ver Seção 6)

**Amazon Brasil** via browser headless:
- URL base: `https://www.amazon.com.br/s?k={query}&s=price-asc-rank`
- Usar `browser navigate` + `browser snapshot` (accessibility tree)
- Extrair por resultado: título, preço, rating (estrelas), número de avaliações, badge Prime/Entrega, link
- Filtro visual: apenas produtos com prazo de entrega exibido na listagem (ignorar "vendido por terceiros" sem prazo claro)

### 4.3 APRESENTAR

Formato WhatsApp (compacto, sem Markdown bruto):

```
🔍 *Resultados: Liquidificador* (rodada 1)

*Mercado Livre*
1. Mondial L-1000 900W — R$ 129,90
   ⭐ 4,7 (342 avail.) | 🚚 Grátis | Loja Oficial ✅ | link

2. Philco PLB 1000W — R$ 148,00
   ⭐ 4,3 (88 avail.) | 🚚 Grátis est. 3d | MercadoLíder Gold | link

*Amazon*
3. Mondial L-1000 900W — R$ 134,99
   ⭐ 4,6 (1.2k avail.) | 🚚 Prime — amanhã | link

4. Britânia BLQ1500P — R$ 159,90
   ⭐ 4,4 (203 avail.) | 🚚 3–5 dias | link

Quer refinar a busca ou escolher entre essas opções?
```

Legenda dos campos exibidos por item:
| Campo | Fonte ML | Fonte Amazon |
|---|---|---|
| Preço | `price` | texto do snapshot |
| Rating | `reviews.rating_average` | texto do snapshot |
| Nº avaliações | `reviews.total` | texto do snapshot |
| Frete | `shipping.free_shipping` | badge Prime / estimativa |
| Tipo de seller | `official_store_name` / `power_seller_status` | "Vendido por Amazon" ou terceiros |
| Link | `permalink` | URL canônica do produto |

### 4.4 REFINAR

O casal pode responder:
- "Muito caro, busca até R$120" → busca com `price_max`
- "Só Mondial" → refina o query
- "Prefiro só com frete grátis" → filtra `free_shipping=true`
- "Descarta a Amazon, foca no ML" → busca só no ML
- "Chega, compara as 3 melhores" → pula para FINALIZAR

### 4.5 FINALIZAR

Apresenta tabela comparativa final (máx. 5 opções):

```
📊 *Comparação Final: Liquidificador*

| # | Produto | Loja | Preço | ⭐ | Frete |
|---|---------|------|-------|-----|-------|
| 1 | Mondial L-1000 900W | ML (Loja Oficial) | R$129,90 | 4,7 | Grátis |
| 2 | Mondial L-1000 900W | Amazon | R$134,99 | 4,6 | Prime |
| 3 | Philco PLB 1000W | ML | R$148,00 | 4,3 | Grátis |

🏆 *Recomendação C3PO:* Opção 1 — menor preço, maior avaliação, loja oficial ML.

Links:
1. mercadolivre.com.br/...
2. amazon.com.br/...
3. mercadolivre.com.br/...
```

O C3PO dá uma recomendação com base no score ponderado (ver Seção 5).

---

## 5) Algoritmo de Score

Cada produto recebe uma pontuação de 0–100 para ranqueamento:

| Critério | Peso | Como calcular |
|---|---|---|
| Preço | 35% | Inversamente proporcional ao maior preço do conjunto |
| Avaliação | 25% | `rating / 5.0` |
| Nº avaliações (confiança) | 15% | `log10(total+1) / log10(max_total+1)` |
| Frete gratuito | 15% | 1.0 se grátis, 0.5 se até 3 dias, 0.0 se desconhecido |
| Qualidade do seller | 10% | 1.0 = Loja Oficial/Amazon; 0.8 = MercadoLíder Ouro/Platina; 0.5 = outros |

Produtos com prazo de entrega estimado > 15 dias são **eliminados** antes do score.

---

## 6) Estimativa de Prazo de Entrega (Mercado Livre)

A API pública do ML não retorna prazo exato na busca. A heurística usada pelo script:

| `logistic_type` | `power_seller_status` | Estimativa |
|---|---|---|
| `fulfillment` (ML armazena) | qualquer | ≤ 3 dias ✅ |
| `xd_drop_off` | gold/platinum | ≤ 5 dias ✅ |
| `cross_docking` | gold/platinum | ≤ 7 dias ✅ |
| `cross_docking` | silver/sem | ≤ 12 dias ✅ |
| `not_specified` | qualquer | desconhecido (flag "⚠️ verificar") |
| qualquer | sem reputação | potencialmente > 15 dias ❌ descartado |

Para o Amazon: o prazo vem direto do snapshot (texto da listagem, ex: "Receba amanhã" ou "Em 3–5 dias").

---

## 7) Arquivos a Criar

### 7.1 `skills/shopping-comparison/SKILL.md`

Arquivo de instrução da skill no formato OpenClaw:

```yaml
---
name: shopping-comparison
description: Pesquisa e compara produtos no Mercado Livre e Amazon Brasil de forma iterativa, refinando até 5 melhores opções por preço, avaliação e prazo de entrega.
tags:
  - shopping
  - compras
  - mercadolivre
  - amazon
  - comparação
---
```

Corpo: instruções detalhadas do fluxo ENTENDER → BUSCAR → APRESENTAR → REFINAR → FINALIZAR, incluindo comandos de exec e browser a usar.

### 7.2 `scripts/c3po-shopping-ml.ts`

Script TypeScript que encapsula a chamada à API pública do Mercado Livre:

```
bun scripts/c3po-shopping-ml.ts --query "liquidificador mondial" [--limit 20] [--max-price 200] [--free-shipping] [--official-store]
```

Saída: JSON com array de produtos ranqueados pelo score da Seção 5.

Campos de saída por produto:
```json
{
  "rank": 1,
  "id": "MLB...",
  "title": "Liquidificador Mondial L-1000",
  "price": 129.90,
  "currency": "BRL",
  "rating": 4.7,
  "reviews_total": 342,
  "free_shipping": true,
  "estimated_delivery": "≤3 dias",
  "seller_type": "official_store",
  "seller_name": "Mondial Oficial",
  "permalink": "https://...",
  "score": 91.3
}
```

### 7.3 Atualização de `openclaw/exec-approvals.json.example`

Adicionar o novo script à allowlist de exec:
```json
{
  "script": "scripts/c3po-shopping-ml.ts",
  "description": "Busca produtos no Mercado Livre via API pública"
}
```

### 7.4 Atualização de `TOOLS.md`

Adicionar seção "Shopping" documentando o novo script e a skill.

---

## 8) Dependências e Pré-requisitos

| Item | Status | Notas |
|---|---|---|
| Mercado Livre API pública | ✅ Sem auth | `api.mercadolibre.com/sites/MLB/search` — sem token necessário |
| Amazon BR API oficial | ❌ Indisponível | PA-API descontinuado em Abril/2026; Creators API requer conta de afiliado |
| Browser headless | ✅ Já existe | Configurado em `openclaw.json5` — usado para Amazon |
| Bun runtime | ✅ Já existe | Para executar o script TypeScript |
| SERPAPI | ❌ Não usar | Custo desnecessário dado que ML tem API pública gratuita |

**Limitação Amazon**: A busca no Amazon.com.br é feita via browser headless (scraping da página de resultados). Isso é mais lento e frágil do que uma API, mas é a única opção gratuita disponível. Se o layout mudar, o snapshot pode precisar de ajuste.

**Limitação ML prazo**: O prazo exato de entrega por CEP só é acessível com autenticação. A skill usa heurística baseada em `logistic_type` + reputação do seller.

---

## 9) Exemplos de Triggers no WhatsApp

```
c3po, me ajuda a comprar um liquidificador
c3po, pesquisa fone bluetooth até R$200 no mercado livre e amazon
c3po, compara opções de tapete de yoga
c3po, quero comprar um kindle, quais as opções?
```

---

## 10) Critérios de Aceitação

- [ ] Pesquisa em ML retorna resultados ordenados por preço com avaliação e tipo de seller
- [ ] Pesquisa na Amazon via browser retorna título, preço, rating e prazo de entrega
- [ ] Resultados com prazo estimado > 15 dias são descartados automaticamente
- [ ] O loop de refinamento funciona com até N rodadas, sem limite fixo
- [ ] O FINALIZAR entrega no máximo 5 opções com recomendação clara
- [ ] Toda a comunicação é em pt-BR, formato WhatsApp (sem Markdown bruto)
- [ ] Nenhum dado sensível é logado em `memory/`
- [ ] A skill funciona sem nenhuma chave de API adicional (ML é pública, Amazon via browser)

---

## 11) Riscos e Mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Amazon muda layout, snapshot quebra | Média | Retry com `browser screenshot` como fallback; avisar casal |
| ML retorna poucos resultados com rating | Baixa | Relaxar filtro de rating para ≥ 3.5 se nenhum resultado ≥ 4.0 |
| Busca muito genérica retorna lixo | Média | Fase ENTENDER sempre pede refinamento antes de buscar |
| PA-API Amazon descontinuada (Abril/2026) | Alta (já acontecendo) | Confirmado: não usar API, usar somente browser |
| Rate limit ML API | Baixa | API pública tem rate limit generoso para uso esporádico; sem paginação agressiva |

---

## 12) Decisões de Design

**Por que não usar SERPAPI ou Unwrangle?**
Custo desnecessário. O ML tem API pública gratuita e o browser já existe no C3PO para a Amazon.

**Por que o script TypeScript para ML e não o browser?**
A API do ML retorna dados estruturados (JSON) muito mais confiáveis do que scraping via snapshot. O browser é reservado para o Amazon onde não há alternativa gratuita.

**Por que não salvar resultados no KB?**
Preços mudam frequentemente. Salvar em `memory/` (log operacional diário) é suficiente para contexto imediato. Se o casal quiser registrar uma decisão de compra, isso vai para `kb/decisoes.md` de forma explícita.

**Por que máximo 5 opções finais?**
Decisão orientada por UX: mais do que 5 opções no WhatsApp gera paralisia de escolha. O refinamento iterativo antes do final garante que as 5 opções são relevantes.
