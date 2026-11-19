# Presentation generation

Ask the assistant for a presentation ("make a 10-slide deck about our onboarding process", "turn this into
slides", "create a pitch deck from my knowledge base") and it creates a real, editable **.pptx** file that
appears as a file card under the chat message, with a live slide preview and a download button.

## How it works

```
chat message ──► Node API (intent detection)
                    │   short confirmation reply is streamed to the user (chat model)
                    └─► ai-service  POST /files/deck
                            1. gather material: user request + previous answer / attached files / knowledge base passages
                            2. plan: the LLM returns ONE JSON "deck spec" (theme, slides, layouts, notes)
                            3. validate + repair (Pydantic), retry once with the parse error, outline fallback
                            4. render a native .pptx (python-pptx) with the chosen theme
                    ◄── file (base64) + preview data (deck spec + theme colors)
Node API stores the artifact ──► web app shows the card, live preview and download
```

Files:

| Where | File | Purpose |
|---|---|---|
| ai-service | `app/schemas/deck.py` | deck spec schema; cleans and length-limits every text field |
| ai-service | `app/services/deck_themes.py` | 8 palettes + font pairs, contrast-safe derived colors |
| ai-service | `app/services/deck_planner.py` | prompt, JSON extraction/repair, slide-count parsing, fallback outline |
| ai-service | `app/services/pptx_builder.py` | renderer (12 layouts), theme written into the file, notes, charts, tables |
| ai-service | `app/api/files.py` | `POST /files/deck` (and the older `POST /files/generate`, now using the same renderer) |
| api | `src/modules/chat/deck-flow.service.js` | pure helpers for the chat flow (prompt guide, request building) |
| web | `src/components/chat/deck-preview/*` | live slide preview drawn from the deck spec |

## Layouts

`title`, `section`, `bullets` (numbered rows + optional key-takeaway panel), `two_column`, `cards`, `stats`,
`timeline`, `table`, `chart` (column, bar, line, pie, doughnut; native, editable charts), `quote`, `closing`.
A slide whose content is missing falls back to a clean bullet slide instead of failing.

Design rules baked into the renderer: 16:9, consistent title position, dark title/section/closing slides with
light content slides, circles as the single visual motif, no decorative underlines, real title placeholders
(outline view and screen readers work), text that does not fit is shortened or split onto a continuation slide
rather than shrunk below readable sizes, and the palette and fonts are written into the file's own theme.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PPTX_MODE` | `structured` | `legacy` restores the old behaviour (chat answer parsed into plain bullet slides) |
| `GEMINI_*_TIMEOUT_SECONDS` | see `.env.example` | how patient the Gemini provider is when planning a deck |

Slide count ("12 slides"), a named file ("called q3.pptx") and the topic are detected from the message. The
planner never invents statistics: charts, stats and quotes are only used when the material supports them.

## Tests

- ai-service: `python -m pytest tests/test_deck_generation.py` (schema, themes, planner with a fake model,
  every layout and chart type, the endpoint, filename sanitising, legacy endpoint)
- api: `npx vitest run tests/deck-flow.test.js` (chat-flow helpers, AI client call, config switch)
