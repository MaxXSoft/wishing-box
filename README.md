# Wishing Box

> [!NOTE]
> This repository is AI generated.

A magical app store powered by LLM hallucination. Describe any app you want, and an LLM generates a fully interactive HTML prototype that runs in your browser — no real code, just creativity and hallucination.

## How it works

1. **Search** — describe an app in natural language (e.g., "a todo list with cosmic horror theme")
2. **Browse** — the LLM generates 10 creative app ideas with different angles
3. **Open** — pick one and the LLM builds a complete, interactive HTML page
4. **Interact** — click buttons, fill forms, and the LLM updates the page in real time via diffs

## Setup

Open `index.html` in a browser. Click the settings gear to configure:

- **API Base URL** — any OpenAI-compatible endpoint (defaults to OpenAI)
- **API Key** — your API key (optional if the endpoint doesn't require auth)
- **Model** — the model name to use

Everything runs client-side. Configuration is stored in `localStorage`.

## Inspiration

Inspired by [this YouTube video](https://www.youtube.com/watch?v=zh6fMtL_cSM).

## License

MIT
