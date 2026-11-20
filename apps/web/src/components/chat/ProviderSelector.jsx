import React from "react";

const PROVIDERS = {
  groq: {
    name: "Groq ⚡",
    models: [
      {
        id: "qwen/qwen3.8-27b",
        name: "Qwen 3.8 27B ⚡",
        free: true,
        recommended: true,
        context: "131K tokens",
        limit: "Ultra-fast LPU",
      },
      {
        id: "openai/gpt-oss-120b",
        name: "GPT OSS 120B",
        free: true,
        recommended: false,
        context: "131K tokens",
        limit: "Reasoning enabled",
      },
      {
        id: "openai/gpt-oss-20b",
        name: "GPT OSS 20B",
        free: true,
        recommended: false,
        context: "131K tokens",
        limit: "Lightweight",
      },
      {
        id: "allam-2-7b",
        name: "ALLaM 2 7B",
        free: true,
        recommended: false,
        context: "4K tokens",
        limit: "Fast bilingual",
      },
      {
        id: "openai/gpt-oss-safeguard-20b",
        name: "Safety GPT OSS 20B",
        free: true,
        recommended: false,
        context: "131K tokens",
        limit: "Guardrail",
      },
    ],
  },
  gemini: {
    name: "Google Gemini",
    models: [
      {
        id: "gemini-3.5-flash-lite",
        name: "Gemini 3.5 Flash Lite ⚡",
        free: true,
        recommended: true,
        context: "32K tokens",
        limit: "500 req/day",
      },
      {
        id: "gemini-3.8-flash",
        name: "Gemini 3.8 Flash",
        free: true,
        recommended: false,
        context: "1M tokens",
        limit: "20 req/day",
      },
      {
        id: "gemini-3.6-flash",
        name: "Gemini 3.6 Flash",
        free: true,
        context: "1M tokens",
        limit: "20 req/day",
      },
    ],
  },
  openrouter: {
    name: "OpenRouter",
    models: [
      {
        id: "nvidia/nemotron-3-ultra-550b-a55b:free",
        name: "NVIDIA Nemotron 3 Ultra",
        free: true,
        recommended: true,
        context: "1M tokens",
        limit: "Provider-dependent",
      },
      {
        id: "nvidia/nemotron-3.5-super-vl:free",
        name: "NVIDIA Nemotron 3.5 Super VL",
        free: true,
        context: "262K tokens",
        limit: "Provider-dependent",
      },
      {
        id: "openrouter/free",
        name: "OpenRouter Free (Dynamic)",
        free: true,
        context: "Varies",
        limit: "Provider-dependent",
      },
      {
        id: "google/gemma-4:free",
        name: "Google Gemma 4",
        free: true,
        context: "32K tokens",
        limit: "Provider-dependent",
      },
    ],
  },
};

export function ProviderSelector({
  selectedProvider,
  onProviderChange,
  selectedModel,
  onModelChange,
}) {
  const currentModels = PROVIDERS[selectedProvider]?.models || [];

  return (
    <div className="provider-selector">
      <div className="selector-group">
        <label>Provider</label>
        <select
          value={selectedProvider}
          onChange={(e) => {
            const newProvider = e.target.value;
            onProviderChange(newProvider);
            // Auto-select first model
            const firstModel = PROVIDERS[newProvider]?.models[0];
            if (firstModel) {
              onModelChange(firstModel.id);
            }
          }}
        >
          {Object.entries(PROVIDERS).map(([key, provider]) => (
            <option key={key} value={key}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>

      <div className="selector-group">
        <label>Model</label>
        <select value={selectedModel} onChange={(e) => onModelChange(e.target.value)}>
          {currentModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
              {model.recommended && " ⭐"}
              {model.free && " (FREE)"}
            </option>
          ))}
        </select>
      </div>

      <div className="model-info">
        {currentModels
          .filter((m) => m.id === selectedModel)
          .map((model) => (
            <div key={model.id} className="info-badge">
              <span className="badge free">FREE</span>
              <span className="badge context">{model.context}</span>
              <span className="badge limit">{model.limit}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
