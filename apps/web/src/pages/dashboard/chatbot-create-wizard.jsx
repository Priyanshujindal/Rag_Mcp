import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Globe,
  Upload,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  ExternalLink,
  Database,
} from "lucide-react";
import {
  getMockKnowledgeBases,
  createKnowledgeBase,
  createUrlSource,
  uploadSourceFile,
  getSource,
  createChatbot,
  getApiOrigin,
  isMock,
} from "@/lib/api";
import "./chatbot-create-wizard.css";

const STEPS = [
  { id: 1, title: "Knowledge Base" },
  { id: 2, title: "Bot Setup" },
  { id: 3, title: "Deploy & Embed" },
];

const WEBSITE_MODEL_GROUPS = [
  {
    label: "Google Gemini",
    options: [
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite ⚡ (Fast & Stable)" },
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
    ],
  },
  {
    label: "Cloudflare Workers AI",
    options: [
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B ⚡ (Fast & Smart)" },
      { id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B (Ultra Fast)" },
      { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1 24B" },
      { id: "@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B" },
    ],
  },
  {
    label: "Groq",
    options: [
      { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B ⚡ (Ultra Fast & Reasoning)" },
    ],
  },
  {
    label: "OpenRouter",
    options: [
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B (Free)" },
    ],
  },
];

export default function CreateChatbotWizard() {
  const [step, setStep] = useState(1);

  // Step 1: Knowledge Base (Existing or Create New)
  const [kbs, setKbs] = useState([]);
  const [kbMode, setKbMode] = useState("existing"); // 'existing' | 'new'
  const [selectedKb, setSelectedKb] = useState("");
  const [newKbName, setNewKbName] = useState("");
  const [sourceType, setSourceType] = useState("url"); // 'url' | 'files'
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [files, setFiles] = useState([]);
  const [ingesting, setIngesting] = useState(false);
  const [ingestStatus, setIngestStatus] = useState("");

  // Step 2: Bot details
  const [botName, setBotName] = useState("Support Copilot");
  const [model, setModel] = useState("gemini-3.5-flash-lite");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful technical assistant. Answer questions concisely based on the indexed knowledge base."
  );
  const [creating, setCreating] = useState(false);

  // Step 3: Embed & Share
  const [copied, setCopied] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const [createdBotId, setCreatedBotId] = useState("bot_demo");
  const [createdBotPublicId, setCreatedBotPublicId] = useState("bot_demo");
  const [error, setError] = useState(null);

  useEffect(() => {
    getMockKnowledgeBases().then((data) => {
      if (Array.isArray(data) && data.length > 0) {
        setKbs(data);
        setSelectedKb(data[0].id || data[0]._id);
        setKbMode("existing");
      } else {
        setKbMode("new");
      }
    });
  }, []);

  const handleStep1Continue = async () => {
    setError(null);
    if (kbMode === "existing") {
      if (!selectedKb) {
        setError("Please select a Knowledge Base or create a new one.");
        return;
      }
      setStep(2);
      return;
    }

    // Create new KB + ingest real source
    const kbTitle = newKbName.trim() || `${botName.trim() || "Chatbot"} Knowledge Base`;
    if (sourceType === "url" && !websiteUrl.trim()) {
      setError("Please enter a website URL to crawl.");
      return;
    }
    if (sourceType === "files" && files.length === 0) {
      setError("Please select at least one file to upload.");
      return;
    }

    setIngesting(true);
    setIngestStatus("Creating Knowledge Base...");
    try {
      const createdKb = await createKnowledgeBase({
        name: kbTitle,
        description: `Knowledge base created for ${botName || "chatbot"}`,
      });
      const kbId = createdKb.id || createdKb._id;

      let createdSourceIds = [];
      if (sourceType === "url") {
        let sourceName = kbTitle;
        try {
          sourceName = new URL(websiteUrl.trim()).hostname || kbTitle;
        } catch {}
        setIngestStatus(`Queuing crawl for ${sourceName}...`);
        const src = await createUrlSource({
          knowledgeBaseId: kbId,
          name: sourceName,
          url: websiteUrl.trim(),
        });
        if (src?.id || src?._id) createdSourceIds.push(src.id || src._id);
      } else {
        setIngestStatus(`Uploading ${files.length} file(s)...`);
        for (const f of files) {
          const src = await uploadSourceFile(kbId, f);
          if (src?.id || src?._id) createdSourceIds.push(src.id || src._id);
        }
      }

      // Poll source status until INDEXED or FAILED (up to 3 minutes) so chunks are ready before chatting
      let totalIndexedChunks = 0;
      if (!isMock && createdSourceIds.length > 0) {
        const lastSourceId = createdSourceIds[createdSourceIds.length - 1];
        for (let attempt = 0; attempt < 90; attempt++) {
          await new Promise((r) => setTimeout(r, 2000));
          let srcState;
          try {
            srcState = await getSource(lastSourceId);
          } catch {
            continue;
          }
          const st = (srcState?.status || "").toUpperCase();
          setIngestStatus(`Indexing (${st || "PROCESSING"}) — ${srcState?.chunkCount || 0} chunks...`);
          if (st === "INDEXED" || st === "READY" || st === "COMPLETED") {
            totalIndexedChunks = srcState?.chunkCount || 0;
            break;
          }
          if (st === "FAILED") {
            throw new Error(srcState?.error || "Web scraping / indexing failed for this source.");
          }
        }
      }

      const kbWithChunks = { ...createdKb, totalChunks: totalIndexedChunks || createdKb.totalChunks || 0 };
      setKbs((prev) => [kbWithChunks, ...prev]);
      setSelectedKb(kbId);
      setStep(2);
    } catch (err) {
      setError(err.message || "Failed to create knowledge base and ingest source");
    } finally {
      setIngesting(false);
      setIngestStatus("");
    }
  };

  const handleGenerateEmbed = async () => {
    setError(null);
    if (!botName.trim()) {
      setError("Chatbot name is required.");
      return;
    }
    setCreating(true);
    try {
      if (!isMock) {
        const newBot = await createChatbot({
          name: botName.trim(),
          knowledgeBaseId: selectedKb || null,
          status: "ACTIVE",
          config: {
            systemPrompt,
            model,
          },
        });
        if (newBot) {
          if (newBot.id || newBot._id) setCreatedBotId(newBot.id || newBot._id);
          if (newBot.publicId) setCreatedBotPublicId(newBot.publicId);
        }
      }
      setStep(3);
    } catch (err) {
      setError(err.message || "Failed to create chatbot");
    } finally {
      setCreating(false);
    }
  };

  const apiHost = getApiOrigin();

  const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/bot/${createdBotPublicId}`;

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

  const handleCopyShare = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopiedShare(true);
    setTimeout(() => setCopiedShare(false), 2000);
  };

  const selectedKbObj = kbs.find((kb) => (kb.id || kb._id) === selectedKb);

  return (
    <div className="wizard-wrapper">
      {/* Wizard Header */}
      <div className="wizard-header">
        <h1 className="page-title wizard-header-title">Create New Chatbot</h1>
        <p className="page-desc">
          Connect a Knowledge Base, choose one of your AI models, and deploy to any website in 3 steps.
        </p>
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

      {/* Step 1: Knowledge Base Selection or Creation */}
      {step === 1 && (
        <div className="card wizard-card">
          <h3 className="wizard-step-title">Select or Create a Knowledge Base</h3>
          <p className="wizard-step-desc">
            Choose an existing Knowledge Base or ingest a new website / document set right now.
          </p>

          <div className="wizard-source-toggle">
            <button
              type="button"
              className={`btn wizard-source-btn ${kbMode === "existing" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setKbMode("existing")}
              disabled={kbs.length === 0}
            >
              <Database size={15} /> Use Existing KB ({kbs.length})
            </button>
            <button
              type="button"
              className={`btn wizard-source-btn ${kbMode === "new" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setKbMode("new")}
            >
              <Globe size={15} /> Create New KB (URL / Files)
            </button>
          </div>

          {kbMode === "existing" ? (
            <div className="form-row">
              <label className="form-label">Select Knowledge Base</label>
              <select
                className="input"
                value={selectedKb}
                onChange={(e) => setSelectedKb(e.target.value)}
              >
                {kbs.map((kb) => {
                  const id = kb.id || kb._id;
                  return (
                    <option key={id} value={id}>
                      {kb.name} ({kb.totalChunks || 0} chunks)
                    </option>
                  );
                })}
              </select>
              <span className="form-hint">
                Your chatbot will answer questions using the indexed chunks in this Knowledge Base.
              </span>
            </div>
          ) : (
            <>
              <div className="form-row" style={{ marginBottom: "12px" }}>
                <label className="form-label">New Knowledge Base Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Product Documentation KB"
                  value={newKbName}
                  onChange={(e) => setNewKbName(e.target.value)}
                />
              </div>

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
                    The crawler will start at this URL and index pages into the new Knowledge Base.
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
                  <div className="wizard-upload-text">Click or drag & drop files here</div>
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
            </>
          )}

          {error && (
            <div style={{ color: "#ef4444", fontSize: "0.875rem", marginTop: "0.75rem" }}>
              {error}
            </div>
          )}

          <div className="wizard-card-footer">
            <button
              type="button"
              className="btn btn-primary btn-with-icon"
              onClick={handleStep1Continue}
              disabled={ingesting}
            >
              {ingesting ? (
                <>
                  <Loader2 size={14} className="spin" /> {ingestStatus || "Creating & Ingesting..."}
                </>
              ) : (
                <>
                  Configure Bot <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Bot Setup */}
      {step === 2 && (
        <div className="card wizard-card">
          <h3 className="wizard-step-title">Configure Your Chatbot</h3>
          <p className="wizard-step-desc">
            Set identity, choose an AI model from your platform, and define system instructions.
          </p>

          <div className="wizard-form-col">
            <div className="form-row auth-form-row">
              <label className="form-label">Linked Knowledge Base</label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border, #27272a)",
                  background: "rgba(99, 102, 241, 0.08)",
                  fontSize: "13px",
                }}
              >
                <span>
                  <Database size={14} style={{ marginRight: "6px", verticalAlign: "middle" }} />
                  <strong>{selectedKbObj?.name || "Selected Knowledge Base"}</strong>{" "}
                  ({selectedKbObj?.totalChunks || 0} chunks)
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setStep(1)}
                >
                  Change
                </button>
              </div>
            </div>

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
              <label className="form-label">Underlying LLM Model</label>
              <select
                className="input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {WEBSITE_MODEL_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
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
              onClick={() => setStep(1)}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              className="btn btn-primary btn-with-icon"
              onClick={handleGenerateEmbed}
              disabled={creating}
            >
              {creating ? "Creating Chatbot..." : "Create & Get Embed Code"}{" "}
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Embed Code & Public Share Link */}
      {step === 3 && (
        <div className="card wizard-card">
          <div className="wizard-success-header">
            <div className="wizard-success-icon">
              <CheckCircle2 size={24} className="wizard-success-icon-svg" />
            </div>
            <div>
              <h3 className="wizard-success-title">Chatbot Ready to Deploy!</h3>
              <p className="wizard-step-desc">
                Paste this script snippet into your website&apos;s HTML before the closing{" "}
                <code>&lt;/body&gt;</code> tag, or share the public link directly.
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
            <pre className="wizard-code-pre">{embedScript}</pre>
          </div>

          {/* Public Share Link Box */}
          <div className="code-snippet-box wizard-code-snippet-box" style={{ marginTop: "12px" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm code-copy-btn btn-with-icon"
              onClick={handleCopyShare}
            >
              {copiedShare ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
              {copiedShare ? "Copied!" : "Copy Public Link"}
            </button>
            <pre className="wizard-code-pre">{shareUrl}</pre>
          </div>

          {/* Action Buttons */}
          <div className="wizard-deploy-actions">
            <Link to="/chatbots" className="btn btn-secondary">
              View All Chatbots
            </Link>

            <a
              href={`/bot/${createdBotPublicId}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-with-icon"
            >
              Open Public Bot <ExternalLink size={14} />
            </a>

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
