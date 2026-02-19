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

# Skill: Comparação de Compras

## Quando usar

Use esta skill quando o casal pedir ajuda para comparar ou pesquisar produtos para comprar online. Exemplos:

- "c3po, me ajuda a comprar um liquidificador"
- "c3po, pesquisa fone bluetooth até R$200"
- "c3po, compara opções de tapete de yoga"
- "c3po, quero comprar um kindle"
- "c3po, qual o melhor robô aspirador barato?"

## Critérios de busca (sempre aplicar)

- **Prazo de entrega:** máximo 15 dias — descartar itens com prazo estimado maior
- **Preço:** ordenar do menor para o maior
- **Avaliação:** preferir produtos com ≥ 4.0 estrelas; relaxar para ≥ 3.5 se não houver resultados suficientes
- **Frete:** preferir grátis, mas não é eliminatório
- **Seller ML:** preferir Loja Oficial e MercadoLíder Ouro/Platina
- **Apenas Brasil** — não considerar sellers internacionais ou importação

## Fluxo

```
ENTENDER → BUSCAR → APRESENTAR → REFINAR? → FINALIZAR (≤ 5 opções)
```

### 1. ENTENDER

- Se o pedido for vago, pergunte no máximo 2–3 perguntas antes de buscar:
  - "Tem orçamento em mente?"
  - "Alguma marca ou característica específica?"
  - "Prefere Mercado Livre, Amazon, ou os dois?"
- Se o pedido já for específico o suficiente, vá direto para BUSCAR.

### 2. BUSCAR

Execute **uma única chamada** que busca ML e Amazon em paralelo:

```
bun scripts/c3po-shopping-browser.ts \
  --query "TERMO_DE_BUSCA" \
  --source both \
  [--max-price VALOR] \
  [--min-rating 4.0] \
  [--free-shipping] \
  [--official-store] \
  [--limit 10]
```

O script retorna JSON com produtos de ML e Amazon já unificados e ranqueados por score. Cada item tem um campo `source` ("ml" ou "amazon"). Use os resultados diretamente — não é necessário fazer buscas separadas.

> **Como funciona:** usa Playwright headless (Chromium) para raspar os sites de busca do ML e da Amazon diretamente, sem depender de API nem de autenticação.
>
> **Flags de fonte única:** `--source ml` (só ML) ou `--source amazon` (só Amazon) — útil quando o casal pede para descartar uma das fontes.
>
> **Fallback (CAPTCHA/bloqueio):** se o script retornar erro de CAPTCHA ou bloqueio, use o browser tool do OpenClaw diretamente:
> 1. `browser navigate "https://www.mercadolivre.com.br/busca?as_word=TERMO&sort=price_asc"`
> 2. `browser snapshot` — extrair títulos, preços, ratings, frete e links manualmente
> 3. Informar o casal que os resultados vieram via browser interativo (raspagem temporariamente bloqueada)

### 3. APRESENTAR

Formato WhatsApp compacto (seguir `whatsapp-styling-guide`). Usar negrito, sem tabelas brutas:

```
🔍 *Resultados: [produto]* (rodada N)

*Mercado Livre*
1. [Título curto] — R$ [preço]
   ⭐ [rating] ([nº] aval.) | 🚚 [frete] | [tipo seller] | [link curto]

2. ...

*Amazon*
3. [Título curto] — R$ [preço]
   ⭐ [rating] ([nº] aval.) | 🚚 [prazo] | [link curto]

Quer refinar ou escolher entre essas opções?
```

Exibir entre 3 e 8 opções por rodada. Numerar globalmente (ML + Amazon juntos).

**Tipo de seller ML:**
- "Loja Oficial ✅" — quando `seller_type == "official_store"`
- "MercadoLíder 🥇" — quando `power_seller_status` é gold ou platinum
- omitir linha se não tiver dado de qualidade

### 4. REFINAR (loop)

Responder ao feedback do casal e repetir BUSCAR com parâmetros ajustados:

| Feedback | Ação |
|---|---|
| "Muito caro, busca até R$X" | Adicionar `--max-price X` |
| "Só [marca]" | Refinar o termo de busca |
| "Só com frete grátis" | Adicionar `--free-shipping` |
| "Só Loja Oficial" | Adicionar `--official-store` |
| "Descarta a Amazon" | Adicionar `--source ml` na próxima chamada |
| "Descarta o ML" | Adicionar `--source amazon` na próxima chamada |
| "Chega, compara os melhores" | Ir para FINALIZAR com os atuais |

Não há limite de rodadas — o casal controla quando parar.

### 5. FINALIZAR

Quando o casal pedir para encerrar ou quando restar ≤ 5 opções claras:

1. Selecionar as **até 5 melhores** com base no score (preço + avaliação + frete + seller)
2. Apresentar comparação final:

```
📊 *Comparação Final: [produto]*

1. *[Título]* — R$ [preço]
   Loja: [ML/Amazon] ([tipo seller])
   ⭐ [rating] ([nº] aval.) | 🚚 [frete/prazo]
   🔗 [link]

2. ...

🏆 *Recomendação C3PO:* Opção [N] — [motivo em 1 linha].
```

3. Registrar em `memory/YYYY-MM-DD.md`:
   ```
   Pesquisa de compras: [produto] — [N] opções apresentadas. Recomendado: [opção].
   ```

## Recomendação C3PO

Dar uma recomendação clara e curta, priorizando nesta ordem:
1. Melhor relação preço × avaliação (score mais alto)
2. Em caso de empate: preferir frete grátis, depois Loja Oficial/Amazon direta
3. Mencionar o motivo em uma frase

## Regras gerais

- Nunca finalizar compras — a skill é apenas de pesquisa e comparação
- Nunca entrar em contas, preencher dados ou clicar em "Comprar"
- Se o browser Amazon falhar (CAPTCHA, lentidão), prosseguir só com ML e avisar
- Toda comunicação em pt-BR, formato WhatsApp
- Não salvar preços no KB — preços mudam; usar `memory/` apenas para log operacional
