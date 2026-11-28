import React from "react";
import { Link } from "react-router-dom";
import { Shield, ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "#f4f4f5", padding: "40px 20px" }}>
      <div style={{ maxWidth: "820px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #27272a", paddingBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Shield size={22} color="#818cf8" />
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>Privacy Policy</h1>
          </div>
          <Link to="/" style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#818cf8", fontSize: "13px", textDecoration: "none" }}>
            <ArrowLeft size={14} /> Back to App
          </Link>
        </div>

        <p style={{ color: "#a1a1aa", fontSize: "13px", margin: 0 }}>
          Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>

        <section style={{ display: "flex", flexDirection: "column", gap: "10px", lineHeight: 1.7, fontSize: "14px", color: "#d4d4d8" }}>
          <h2 style={{ fontSize: "17px", color: "#f4f4f5", margin: "8px 0 0" }}>1. Information We Collect</h2>
          <p style={{ margin: 0 }}>
            <strong>Rag_Mcp</strong> collects account details you provide (name, email address, and encrypted authentication credentials),
            workspace data (knowledge base documents, crawled URLs, chatbots, and conversation history), and optional third-party
            integration tokens when you choose to connect external apps or custom Model Context Protocol (MCP) servers.
          </p>

          <h2 style={{ fontSize: "17px", color: "#f4f4f5", margin: "12px 0 0" }}>2. How We Use Google Workspace &amp; Third-Party Data</h2>
          <p style={{ margin: 0 }}>
            When you connect Google Workspace services (such as Gmail, Google Drive, or Google Calendar) or other integrations
            (GitHub, Slack, Notion, Linear), Rag_Mcp accesses only the data required to execute the tools you explicitly authorize
            in your chat or workflow. Sensitive actions (such as sending emails or posting messages) support human-in-the-loop approval.
          </p>
          <p style={{ margin: 0 }}>
            Rag_Mcp&apos;s use and transfer of information received from Google APIs adheres to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" style={{ color: "#818cf8" }}>
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. We do not sell your personal data or use your private workspace documents or
            connected Google user data to train third-party foundation models.
          </p>

          <h2 style={{ fontSize: "17px", color: "#f4f4f5", margin: "12px 0 0" }}>3. Data Security &amp; Isolation</h2>
          <p style={{ margin: 0 }}>
            All workspace resources (knowledge bases, vector chunks, chatbots, MCP servers, and API keys) are strictly tenant-isolated
            by workspace. OAuth tokens and custom MCP environment secrets are encrypted at rest and masked in API responses.
          </p>

          <h2 style={{ fontSize: "17px", color: "#f4f4f5", margin: "12px 0 0" }}>4. Data Retention &amp; Deletion</h2>
          <p style={{ margin: 0 }}>
            You can disconnect any OAuth app, delete custom MCP servers, or remove knowledge base sources and chatbots at any time
            from your dashboard. Deleting a source or chatbot removes its associated indexed chunks and configuration.
          </p>

          <h2 style={{ fontSize: "17px", color: "#f4f4f5", margin: "12px 0 0" }}>5. Related Policies</h2>
          <p style={{ margin: 0 }}>
            Please also review our <Link to="/terms" style={{ color: "#818cf8" }}>Terms of Service</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}
