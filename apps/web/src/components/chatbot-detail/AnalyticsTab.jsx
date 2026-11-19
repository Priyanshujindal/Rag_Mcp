import React from "react";
import { Badge } from "@/components/ui/badge";

const UNANSWERED_INQUIRIES = [
  { q: "What is your refund policy for custom enterprise agreements?", score: "42%", date: "2 hours ago" },
  { q: "Do you offer native HIPAA compliance in Canada?", score: "38%", date: "Yesterday" },
  { q: "Can I connect custom Oracle ERP via SAML SSO?", score: "45%", date: "3 days ago" },
];

/**
 * Analytics tab displaying resolution rate, latency, user satisfaction, and unanswered questions.
 */
export function AnalyticsTab() {
  return (
    <div>
      <div className="metrics-grid bot-detail-tabs">
        <div className="metric-card">
          <span className="metric-label">Resolution Rate</span>
          <div className="metric-value metric-val-success">94.2%</div>
          <div className="metric-sub">Questions answered from context</div>
        </div>
        <div className="metric-card">
          <span className="metric-label">Avg Answer Latency</span>
          <div className="metric-value">385ms</div>
          <div className="metric-sub">Time to first token streamed</div>
        </div>
        <div className="metric-card">
          <span className="metric-label">Thumbs Up Ratio</span>
          <div className="metric-value">98.1%</div>
          <div className="metric-sub">User satisfaction rating</div>
        </div>
      </div>

      <div className="card bot-detail-card-padded">
        <h4 className="bot-detail-card-title">
          Recent Unanswered / Unresolved Inquiries
        </h4>
        <p className="bot-detail-card-desc-spaced">
          Questions where retrieval confidence fell below the threshold. Use these to expand your Knowledge Base.
        </p>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Question Asked</th>
                <th>Retrieved Score</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {UNANSWERED_INQUIRIES.map((row, i) => (
                <tr key={i}>
                  <td className="analytics-q-cell">{row.q}</td>
                  <td>
                    <Badge variant="warning">{row.score}</Badge>
                  </td>
                  <td className="analytics-date-cell">{row.date}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm analytics-add-btn">
                      + Add to KB
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

