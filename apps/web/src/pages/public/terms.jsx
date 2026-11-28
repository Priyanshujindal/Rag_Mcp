import React from "react";
import { Link } from "react-router-dom";
import { FileText, ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "#f4f4f5", padding: "40px 20px" }}>
      <div style={{ maxWidth: "820px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #27272a", paddingBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <FileText size={22} color="#818cf8" />
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>Terms of Service</h1>
          </div>
          <Link to="/" style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#818cf8", fontSize: "13px", textDecoration: "none" }}>
            <ArrowLeft size={14} /> Back to App
          </Link>
        </div>

        <p style={{ color: "#a1a1aa", fontSize: "13px", margin: 0 }}>
          Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>

        <section style={{ display: "flex", flexDirection: "column", gap: "10px", lineHeight: 1.7, fontSize: "14px", color: "#d4d4d8" }}>
          <h2 style={{ fontSize: "17px", color: "#f4f4f5", margin: "8px 0 0" }}>1. Acceptance of Terms</h2>
          <p style={{ margin: 0 }}>
            By accessing or using <strong>Rag_Mcp</strong>, you agree to be bound by these Terms of Service and our{" "}
            <Link to="/privacy" style={{ color: "#818cf8" }}>Privacy Policy</Link>.
          </p>

          <h2 style={{ fontSize: "17px", color: "#f4f4f5", margin: "12px 0 0" }}>2. Acceptable Use</h2>
          <p style={{ margin: 0 }}>
            You are responsible for the documents, URLs, chatbots, and custom MCP servers you configure within your workspace.
            You agree not to use the platform to crawl unauthorized or private internal networks, distribute malicious code,
            or violate applicable laws or third-party service terms.
          </p>

          <h2 style={{ fontSize: "17px", color: "#f4f4f5", margin: "12px 0 0" }}>3. Connected Integrations &amp; MCP Tools</h2>
          <p style={{ margin: 0 }}>
            When connecting third-party accounts (such as Google Workspace, GitHub, Slack, Notion, or Linear) or custom MCP servers,
            you authorize Rag_Mcp to execute tool actions on your behalf according to the per-tool permission policies
            (<code>auto</code>, <code>always_ask</code>, or <code>deny</code>) configured in your workspace.
          </p>

          <h2 style={{ fontSize: "17px", color: "#f4f4f5", margin: "12px 0 0" }}>4. Public Chatbots &amp; Embedded Widgets</h2>
          <p style={{ margin: 0 }}>
            If you embed a chatbot widget on an external website or share a public chatbot link, you are responsible for configuring
            appropriate allowed origins, system instructions, and knowledge base content for your visitors.
          </p>

          <h2 style={{ fontSize: "17px", color: "#f4f4f5", margin: "12px 0 0" }}>5. Disclaimer of Warranties</h2>
          <p style={{ margin: 0 }}>
            AI-generated responses are derived from your indexed knowledge bases and connected tools. Rag_Mcp is provided on an
            &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis without warranties of any kind.
          </p>
        </section>
      </div>
    </div>
  );
}
