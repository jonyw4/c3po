---
name: whatsapp-styling-guide
description: Ensures all messages sent to WhatsApp follow the platform's specific formatting syntax instead of Markdown.
tags:
  - whatsapp
  - formatting
  - style
---

# Skill: WhatsApp Styling Guide

## Intent

All messages sent via WhatsApp MUST use WhatsApp-native formatting. Never use Markdown syntax that doesn't render on WhatsApp.

## Allowed formatting

| Format         | Syntax              | Example                   |
|----------------|----------------------|---------------------------|
| Bold           | `*text*`             | *assim fica negrito*      |
| Italic         | `_text_`             | _assim fica itálico_      |
| Strikethrough  | `~text~`             | ~assim fica riscado~      |
| Monospace      | `` ```text``` ``     | ```assim fica mono```     |
| Bullet list    | `* Item` or `- Item` | * Item da lista           |
| Numbered list  | `1. Item`            | 1. Primeiro item          |
| Quote          | `> text`             | > Citação                 |

## Forbidden formatting (does NOT render on WhatsApp)

- **Headers** (`#`, `##`, `###`) — use *BOLD CAPS* instead (e.g., `*TÍTULO*`)
- **Markdown tables** (`| col |`) — use bullet lists instead
- **Horizontal rules** (`---`) — use `________` (underscores) if separation is needed
- **Links** (`[text](url)`) — just paste the URL directly
- **Images** (`![alt](url)`) — not supported in text messages
- **Code blocks with language** (` ```js `) — use plain ` ``` ` without language tag

## Goal

Messages should look *human-to-human* — clean, readable on mobile, no raw Markdown artifacts visible to the user.
