import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Globe, Upload, CheckCircle2, Loader2, ArrowRight, ArrowLeft,
  Copy, Check, ExternalLink
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getMockKnowledgeBases, createChatbot, isMock } from "@/lib/api";
import "./chatbot-create-wizard.css";

const STEPS = [
  { id: 1, title: "Data Source" },
  { id: 2, title: "Crawl & Ingest" },
  { id: 3, title: "Bot Setup" },
  { id: 4, title: "Embed Code" },
];

export default function CreateChatbotWizard() {
  const [step, setStep] = useState(1);
  const [sourceType, setSourceType] = useState("url"); // 'url' | 'files'
  const [websiteUrl, setWebsiteUrl] = useState("https://stripe.com/docs");
  const [files, setFiles] = useState([]);

  // Step 2: Crawl simulation
  const [crawlProgress, setCrawlProgress] = useState(0);
  const [discoveredPages, setDiscoveredPages] = useState([
    { url: "/docs/quickstart", status: "queued", chunks: 0 },
    { url: "/docs/api-reference", status: "queued", chunks: 0 },
    { url: "/docs/webhooks", status: "queued", chunks: 0 },
    { url: "/docs/checkout", status: "queued", chunks: 0 },
    { url: "/docs/billing/subscriptions", status: "queued", chunks: 0 },
  ]);

  // Step 3: Bot details
  const [botName, setBotName] = useState("Stripe API Copilot");
  const [selectedKb, setSelectedKb] = useState("kb_stripe");
  const [model, setModel] = useState("gpt-4o-mini");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful technical assistant. Answer questions concisely with code snippets based on the indexed knowledge base."
  );

  // Step 4: Embed
  const [copied, setCopied] = useState(false);
  const [createdBotId, setCreatedBotId] = useState("bot_stripe_api");
  const [createdBotPublicId, setCreatedBotPublicId] = useState("bot_stripe_api");
  const [kbs, setKbs] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMockKnowledgeBases().then((data) => {
      if (Array.isArray(data) && data.length > 0) {
        setKbs(data);
        setSelectedKb(data[0].id);
      }
    });
  }, []);

  const handleGenerateEmbed = async () => {
    setError(null);
    try {
      if (!isMock) {
        const newBot = await createChatbot({
          name: botName,
          knowledgeBaseId: selectedKb,
          config: {
            systemPrompt,
          },
        });
        if (newBot) {
          if (newBot.id) setCreatedBotId(newBot.id);
          if (newBot.publicId) setCreatedBotPublicId(newBot.publicId);
        }
      }
      setStep(4);
    } catch (err) {
      setError(err.message || "Failed to create chatbot");
    }
  };

  // Simulate live crawling when entering Step 2
  useEffect(() => {
    if (step === 2) {
      setCrawlProgress(15);
      const timer1 = setTimeout(() => {
        setDiscoveredPages((prev) =>
          prev.map((p, i) => (i === 0 ? { ...p, status: "crawling", chunks: 14 } : p))
        );
        setCrawlProgress(35);
      }, 700);

      const timer2 = setTimeout(() => {
        setDiscoveredPages((prev) =>
          prev.map((p, i) =>
            i === 0
              ? { ...p, status: "indexed", chunks: 28 }
              : i <= 2
              ? { ...p, status: "crawling", chunks: 18 }
              : p
          )
        );
        setCrawlProgress(65);
      }, 1600);

      const timer3 = setTimeout(() => {
        setDiscoveredPages((prev) =>
          prev.map((p) => ({ ...p, status: "indexed", chunks: Math.floor(Math.random() * 20) + 15 }))
        );
        setCrawlProgress(100);
      }, 2600);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    }
  }, [step]);

  const apiHost =
    import.meta.env.VITE_API_BASE_URL ||
    (typeof window !== "undefined"
      ? window.location.origin.replace(":5173", ":8000").replace(":3000", ":8000")
      : "http://localhost:8000");

  const embedScript = `<!-- Rag_Mcp Web Chatbot Embed -->
<script
  src="${apiHost}/api/v1/public/widget.js"
  data-bot-id="${createdBotPublicId}"
  data-api-host="${apiHost}"
  data-color="#6366f1"
  defer>
</script>`;

  const handleCopyEmbed = () => {
    navigator.clipboard.writeText(embedScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="wizard-wrapper">
      {/* Wizard Header */}
      <div className="wizard-header">
        <h1 className="page-title wizard-header-title">Create New Chatbot</h1>
        <p className="page-desc">Turn any website or documentation into an embeddable AI assistant in 4 easy steps.</p>
      </div>

      {/* Steps Indicator */}
      <div className="wizard-steps">
        {STEPS.map((s, idx) => {
          const isDone = step > s.id;
          const isActive = step === s.id;
          return (
            <React.Fragment key={s.id}>
              <div className={`wizard-step ${isDone ? "done" : isActive ? "active" : ""}`}>
                <div className="wizard-step-circle">
                  {isDone ? <Check size={14} /> : s.id}
                </div>
                <span className="wizard-step-label">{s.title}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`wizard-step-line ${step > s.id ? "done" : ""}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Step 1: Data Source */}
      {step === 1 && (
        <div className="card wizard-card">
          <h3 className="wizard-step-title">
            Choose Knowledge Source
          </h3>
          <p className="wizard-step-desc">
            Specify the website to crawl or upload documents to train your chatbot.
          </p>

          {/* Toggle URL vs File */}
          <div className="wizard-source-toggle">
            <button
              type="button"
              className={`btn wizard-source-btn ${sourceType === "url" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setSourceType("url")}
            >
              <Globe size={15} /> Website URL Crawl
            </button>
            <button
              type="button"
              className={`btn wizard-source-btn ${sourceType === "files" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setSourceType("files")}
            >
              <Upload size={15} /> Upload Files (PDF, MD, DOCX)
            </button>
          </div>

          {sourceType === "url" ? (
            <div className="form-row">
              <label className="form-label">Website or Documentation Root URL</label>
              <div className="wizard-input-wrapper">
                <Globe size={15} className="wizard-input-icon" />
                <input
                  type="url"
                  className="input wizard-input-with-icon"
                  placeholder="https://docs.yourcompany.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                />
              </div>
              <span className="form-hint">
                The crawler will start at this URL and follow internal links up to 2 levels deep.
              </span>
            </div>
          ) : (
            <div
              className="kb-upload-zone wizard-upload-zone"
              onClick={() => document.getElementById("file-upload")?.click()}
            >
              <input
                id="file-upload"
                type="file"
                multiple
                className="wizard-upload-file-input"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
              <Upload size={28} className="wizard-upload-icon" />
              <div className="wizard-upload-text">
                Click or drag & drop files here
              </div>
              <div className="wizard-upload-subtext">
                Supports PDF, DOCX, TXT, Markdown (up to 50MB each)
              </div>
              {files.length > 0 && (
                <div className="wizard-file-chip">
                  {files.length} file{files.length > 1 ? "s" : ""} selected
                </div>
              )}
            </div>
          )}

          <div className="wizard-crawling-info">
            <CheckCircle2 size={16} className="icon-muted" />
            <span className="wizard-crawling-text">
              Automatic chunking, embedding generation with text-embedding-3-small, and vector indexing is included.
            </span>
          </div>

          <div className="wizard-card-footer">
            <button
              type="button"
              className="btn btn-primary btn-with-icon"
              onClick={() => setStep(2)}
            >
              Start Ingestion <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Crawl & Ingest Simulation */}
      {step === 2 && (
        <div className="card wizard-card">
          <h3 className="wizard-step-title">
            Crawling & Ingesting Knowledge
          </h3>
          <p className="wizard-step-desc">
            Processing content from <strong>{websiteUrl}</strong>. Real-time extraction in progress.
          </p>

          {/* Progress Bar */}
          <div className="wizard-progress-header">
            <span>Indexing Progress</span>
            <span>{crawlProgress}%</span>
          </div>
          <div className="wizard-progress-track">
            <div
              className="wizard-progress-fill"
              style={{ "--progress-width": `${crawlProgress}%` }}
            />
          </div>

          {/* Page status stream */}
          <div className="wizard-pages-list">
            {discoveredPages.map((page) => (
              <div key={page.url} className="wizard-page-item">
                <div className="wizard-page-left">
                  {page.status === "queued" && <div className="badge-dot" />}
                  {page.status === "crawling" && <Loader2 size={13} className="spin wizard-page-spinner" />}
                  {page.status === "indexed" && <CheckCircle2 size={13} color="var(--success)" />}
                  <code>{page.url}</code>
                </div>
                <div className="wizard-page-right">
                  {page.chunks > 0 && (
                    <span className="wizard-page-chunks">{page.chunks} chunks</span>
                  )}
                  <Badge
                    variant={
                      page.status === "indexed" ? "success" : page.status === "crawling" ? "accent" : "neutral"
                    }
                  >
                    {page.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div style={{ color: "#ef4444", fontSize: "0.875rem", marginBottom: "1rem" }}>
              {error}
            </div>
          )}

          <div className="wizard-card-footer-between">
            <button
              type="button"
              className="btn btn-secondary btn-with-icon"
              onClick={() => setStep(1)}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              className="btn btn-primary btn-with-icon"
              disabled={crawlProgress < 100}
              onClick={() => setStep(3)}
            >
              {crawlProgress < 100 ? "Crawling in progress…" : "Configure Bot"} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Bot Setup */}
      {step === 3 && (
        <div className="card wizard-card">
          <h3 className="wizard-step-title">
            Configure Your Chatbot
          </h3>
          <p className="wizard-step-desc">
            Set identity, default AI model, and tone of voice.
          </p>

          <div className="wizard-form-col">
            <div className="form-row auth-form-row">
              <label className="form-label">Chatbot Name</label>
              <input
                type="text"
                className="input"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                placeholder="e.g. Acme Support Bot"
              />
            </div>

            <div className="form-row auth-form-row">
              <label className="form-label">Linked Knowledge Base</label>
              <select
                className="input"
                value={selectedKb}
                onChange={(e) => setSelectedKb(e.target.value)}
              >
                {(kbs.length > 0 ? kbs : [{ id: "default", name: "Workspace Default Knowledge Base", totalChunks: 0 }]).map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name} ({kb.totalChunks || 0} chunks)
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row auth-form-row">
              <label className="form-label">Underlying LLM Model</label>
              <select
                className="input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="gpt-4o-mini">GPT-4o Mini (Fast & Cost Efficient)</option>
                <option value="gpt-4o">GPT-4o (High Intelligence & Reasoning)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Large Context Window)</option>
              </select>
            </div>

            <div className="form-row auth-form-row">
              <label className="form-label">System Instructions</label>
              <textarea
                className="input textarea"
                rows={4}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div style={{ color: "#ef4444", fontSize: "0.875rem", marginBottom: "1rem" }}>
              {error}
            </div>
          )}

          <div className="wizard-card-footer-between">
            <button
              type="button"
              className="btn btn-secondary btn-with-icon"
              onClick={() => setStep(2)}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              className="btn btn-primary btn-with-icon"
              onClick={handleGenerateEmbed}
            >
              Generate Embed Script <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Embed Code */}
      {step === 4 && (
        <div className="card wizard-card">
          <div className="wizard-success-header">
            <div className="wizard-success-icon">
              <CheckCircle2 size={24} className="wizard-success-icon-svg" />
            </div>
            <div>
              <h3 className="wizard-success-title">
                Chatbot Ready to Deploy!
              </h3>
              <p className="wizard-step-desc">
                Paste this script snippet into your website's HTML before the closing <code>&lt;/body&gt;</code> tag.
              </p>
            </div>
          </div>

          {/* Code Snippet Box */}
          <div className="code-snippet-box wizard-code-snippet-box">
            <button
              type="button"
              className="btn btn-secondary btn-sm code-copy-btn btn-with-icon"
              onClick={handleCopyEmbed}
            >
              {copied ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
              {copied ? "Copied!" : "Copy Snippet"}
            </button>
            <pre className="wizard-code-pre">
              {embedScript}
            </pre>
          </div>

          {/* Action Buttons */}
          <div className="wizard-deploy-actions">
            <Link
              to="/chatbots"
              className="btn btn-secondary"
            >
              View All Chatbots
            </Link>

            <Link
              to={`/chatbots/${createdBotId}`}
              className="btn btn-primary btn-with-icon"
            >
              Open Bot Customizer & Analytics <ExternalLink size={14} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
