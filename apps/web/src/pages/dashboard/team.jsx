import React, { useState, useEffect, useMemo } from "react";
import {
  Users,
  UserPlus,
  Shield,
  Trash2,
  Mail,
  Clock,
  CheckCircle,
  AlertTriangle,
  Search,
  Copy,
  Check,
  RefreshCw,
  LogOut,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CardSkeleton } from "@/components/ui/skeleton";
import {
  getTeamMembers,
  inviteTeamMember,
  updateTeamMemberRole,
  removeTeamMember,
  revokeTeamInvite,
  resendTeamInvite,
  leaveWorkspace,
} from "@/lib/api";
import "./team.css";

const ROLE_DESCRIPTIONS = {
  OWNER: "Full workspace control, ownership transfer, MCP servers, API keys & team management.",
  ADMIN: "Manage Custom MCP servers, API keys, chatbots, knowledge bases, and non-OWNER members.",
  MEMBER: "Build chatbots, ingest knowledge bases, connect apps, and approve MCP tool executions.",
  VIEWER: "Read-only access to dashboards, analytics, and conversations.",
};

const DEFAULT_MATRIX = [
  { capability: "View dashboards, analytics, and conversations", OWNER: true, ADMIN: true, MEMBER: true, VIEWER: true },
  { capability: "Chat with AI assistant and knowledge bases", OWNER: true, ADMIN: true, MEMBER: true, VIEWER: true },
  { capability: "Create, edit, and delete Chatbots & Knowledge Bases", OWNER: true, ADMIN: true, MEMBER: true, VIEWER: false },
  { capability: "Connect apps & approve human-in-the-loop MCP tool calls", OWNER: true, ADMIN: true, MEMBER: true, VIEWER: false },
  { capability: "Add, configure, and delete Custom MCP Servers", OWNER: true, ADMIN: true, MEMBER: false, VIEWER: false },
  { capability: "Create, rotate, and revoke Platform API Keys", OWNER: true, ADMIN: true, MEMBER: false, VIEWER: false },
  { capability: "Invite teammates and manage Member/Viewer roles", OWNER: true, ADMIN: true, MEMBER: false, VIEWER: false },
  { capability: "Assign or modify OWNER role & workspace ownership", OWNER: true, ADMIN: false, MEMBER: false, VIEWER: false },
];

function getInitials(name, email) {
  const src = (name || email || "U").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

export default function TeamPage() {
  const [data, setData] = useState({
    workspace: null,
    currentUserRole: "MEMBER",
    permissionsMatrix: DEFAULT_MATRIX,
    members: [],
    invites: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedInviteId, setCopiedInviteId] = useState(null);

  const fetchTeam = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTeamMembers();
      setData({
        workspace: res?.workspace || null,
        currentUserRole: res?.currentUserRole || "MEMBER",
        permissionsMatrix:
          Array.isArray(res?.permissionsMatrix) && res.permissionsMatrix.length > 0
            ? res.permissionsMatrix
            : DEFAULT_MATRIX,
        members: Array.isArray(res?.members) ? res.members : [],
        invites: Array.isArray(res?.invites) ? res.invites : [],
      });
    } catch (err) {
      setError(err.message || "Failed to load team members");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const canManage = data.currentUserRole === "OWNER" || data.currentUserRole === "ADMIN";
  const ownerCount = useMemo(
    () => data.members.filter((m) => m.role === "OWNER").length,
    [data.members]
  );

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return data.members;
    return data.members.filter(
      (m) =>
        (m.name || "").toLowerCase().includes(q) ||
        (m.email || "").toLowerCase().includes(q) ||
        (m.role || "").toLowerCase().includes(q)
    );
  }, [data.members, searchQuery]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await inviteTeamMember({ email: email.trim(), role });
      setSuccess(res?.message || `Invited ${email}`);
      setEmail("");
      await fetchTeam();
    } catch (err) {
      setError(err.message || "Failed to invite member");
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (membershipId, newRole) => {
    setError(null);
    setSuccess(null);
    try {
      await updateTeamMemberRole(membershipId, newRole);
      setSuccess("Updated member role.");
      await fetchTeam();
    } catch (err) {
      setError(err.message || "Failed to update role");
    }
  };

  const handleRemove = async (member) => {
    if (!window.confirm(`Remove ${member.email} from this workspace?`)) return;
    setError(null);
    setSuccess(null);
    try {
      await removeTeamMember(member.id);
      setSuccess(`Removed ${member.email}.`);
      await fetchTeam();
    } catch (err) {
      setError(err.message || "Failed to remove member");
    }
  };

  const handleRevokeInvite = async (inviteId) => {
    setError(null);
    setSuccess(null);
    try {
      await revokeTeamInvite(inviteId);
      setSuccess("Invitation revoked.");
      await fetchTeam();
    } catch (err) {
      setError(err.message || "Failed to revoke invitation");
    }
  };

  const handleResendInvite = async (invite) => {
    setError(null);
    setSuccess(null);
    try {
      const res = await resendTeamInvite(invite.id);
      setSuccess(res?.message || `Refreshed invite for ${invite.email}.`);
      await fetchTeam();
    } catch (err) {
      setError(err.message || "Failed to resend invitation");
    }
  };

  const handleCopyInviteLink = (invite) => {
    const signupUrl = `${window.location.origin}/register?email=${encodeURIComponent(invite.email)}`;
    navigator.clipboard.writeText(signupUrl);
    setCopiedInviteId(invite.id);
    setTimeout(() => setCopiedInviteId(null), 2000);
  };

  const handleLeave = async () => {
    if (!window.confirm("Are you sure you want to leave this workspace?")) return;
    setError(null);
    try {
      await leaveWorkspace();
      window.location.href = "/";
    } catch (err) {
      setError(err.message || "Failed to leave workspace");
    }
  };

  return (
    <div className="team-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Team &amp; Access Control (RBAC)</h1>
          <p className="page-desc">
            Manage workspace members, pending invitations, and role-based permissions for MCP servers, API keys, and tool approvals.
          </p>
        </div>
        <div className="team-header-badges">
          {data.workspace?.name && <Badge variant="neutral">{data.workspace.name}</Badge>}
          <Badge variant={data.currentUserRole === "OWNER" ? "success" : "neutral"}>
            Your Role: {data.currentUserRole}
          </Badge>
          {!(data.currentUserRole === "OWNER" && ownerCount <= 1) && (
            <button type="button" className="mcp-icon-btn danger" onClick={handleLeave}>
              <LogOut size={13} /> Leave Workspace
            </button>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="team-stats-row">
        <div className="team-stat-card">
          <span className="team-stat-label">Active Members</span>
          <span className="team-stat-value">{data.members.length}</span>
        </div>
        <div className="team-stat-card">
          <span className="team-stat-label">Pending Invitations</span>
          <span className="team-stat-value">{data.invites.length}</span>
        </div>
        <div className="team-stat-card">
          <span className="team-stat-label">Admins &amp; Owners</span>
          <span className="team-stat-value">
            {data.members.filter((m) => m.role === "OWNER" || m.role === "ADMIN").length}
          </span>
        </div>
      </div>

      {error && (
        <div className="mcp-alert danger">
          <AlertTriangle size={15} />
          <span>{error}</span>
          <button type="button" className="mcp-alert-close" onClick={() => setError(null)}>
            <X size={13} />
          </button>
        </div>
      )}
      {success && (
        <div className="mcp-alert success">
          <CheckCircle size={15} />
          <span>{success}</span>
          <button type="button" className="mcp-alert-close" onClick={() => setSuccess(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      {/* Invite Card */}
      {canManage && (
        <div className="team-card">
          <div className="team-card-header" style={{ marginBottom: "10px" }}>
            <h3 className="team-card-title">
              <UserPlus size={15} /> Invite Teammate
            </h3>
          </div>
          <form onSubmit={handleInvite} className="team-invite-form">
            <div className="team-invite-email">
              <label className="form-label" style={{ display: "block", marginBottom: "6px" }}>
                Email Address
              </label>
              <input
                type="email"
                className="form-input"
                placeholder="teammate@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="team-invite-role">
              <label className="form-label" style={{ display: "block", marginBottom: "6px" }}>
                Role
              </label>
              <select
                className="form-input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="ADMIN">ADMIN</option>
                <option value="MEMBER">MEMBER</option>
                <option value="VIEWER">VIEWER</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-with-icon" disabled={inviting}>
              <UserPlus size={15} /> {inviting ? "Sending..." : "Send Invite"}
            </button>
          </form>
          <div className="team-invite-hint">
            <strong>{role}:</strong> {ROLE_DESCRIPTIONS[role]} Existing users join immediately; new users auto-join on registration.
          </div>
        </div>
      )}

      {/* Members List */}
      {loading ? (
        <CardSkeleton />
      ) : (
        <div className="team-card">
          <div className="team-card-header">
            <h3 className="team-card-title">
              <Users size={16} /> Workspace Members ({filteredMembers.length})
            </h3>
            <div className="team-search-wrap">
              <Search size={13} className="team-search-icon" />
              <input
                type="text"
                className="team-search-input"
                placeholder="Search by name, email, or role..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {filteredMembers.length === 0 ? (
              <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "12px 0" }}>
                No matching members found.
              </div>
            ) : (
              filteredMembers.map((m) => {
                const canEditThisMember =
                  canManage &&
                  !m.isCurrentUser &&
                  !(m.role === "OWNER" && data.currentUserRole !== "OWNER");

                return (
                  <div key={m.id} className="team-member-row">
                    <div className="team-member-left">
                      <div className="team-avatar">{getInitials(m.name, m.email)}</div>
                      <div>
                        <div className="team-member-name">
                          {m.name}
                          {m.isCurrentUser && (
                            <span style={{ color: "#818cf8", fontSize: "11px" }}>(You)</span>
                          )}
                        </div>
                        <div className="team-member-meta">
                          {m.email}
                          {m.joinedAt && ` • Joined ${new Date(m.joinedAt).toLocaleDateString()}`}
                        </div>
                      </div>
                    </div>

                    <div className="team-member-actions">
                      {canEditThisMember ? (
                        <select
                          className="team-role-select"
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.id, e.target.value)}
                        >
                          {data.currentUserRole === "OWNER" && <option value="OWNER">OWNER</option>}
                          <option value="ADMIN">ADMIN</option>
                          <option value="MEMBER">MEMBER</option>
                          <option value="VIEWER">VIEWER</option>
                        </select>
                      ) : (
                        <Badge variant={m.role === "OWNER" ? "success" : "neutral"}>
                          <Shield size={11} style={{ marginRight: "4px" }} />
                          {m.role}
                        </Badge>
                      )}

                      {canEditThisMember && (
                        <button
                          type="button"
                          className="mcp-icon-btn danger"
                          onClick={() => handleRemove(m)}
                          title="Remove member"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {data.invites.length > 0 && (
            <div style={{ marginTop: "22px" }}>
              <h4
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "10px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  color: "var(--text-muted)",
                }}
              >
                <Clock size={14} /> Pending Invitations ({data.invites.length})
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {data.invites.map((inv) => (
                  <div
                    key={inv.id}
                    className="team-member-row"
                    style={{ borderStyle: "dashed" }}
                  >
                    <div className="team-member-left">
                      <Mail size={14} style={{ color: "var(--text-muted)" }} />
                      <div>
                        <div className="team-member-name">
                          <span>{inv.email}</span>
                          <Badge variant="neutral">{inv.role}</Badge>
                        </div>
                        <div className="team-member-meta">
                          Invited by {inv.invitedBy} • {new Date(inv.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <div className="team-member-actions">
                      <button
                        type="button"
                        className="mcp-icon-btn"
                        onClick={() => handleCopyInviteLink(inv)}
                        title="Copy signup link"
                      >
                        {copiedInviteId === inv.id ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedInviteId === inv.id ? "Copied" : "Copy Link"}</span>
                      </button>
                      {canManage && (
                        <>
                          <button
                            type="button"
                            className="mcp-icon-btn"
                            onClick={() => handleResendInvite(inv)}
                            title="Refresh invitation"
                          >
                            <RefreshCw size={12} />
                            <span>Resend</span>
                          </button>
                          <button
                            type="button"
                            className="mcp-icon-btn danger"
                            onClick={() => handleRevokeInvite(inv.id)}
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Role & Permissions Matrix */}
      <div className="team-card">
        <div className="team-card-header">
          <h3 className="team-card-title">
            <Shield size={15} /> Role &amp; Permissions Matrix
          </h3>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="team-matrix-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>OWNER</th>
                <th>ADMIN</th>
                <th>MEMBER</th>
                <th>VIEWER</th>
              </tr>
            </thead>
            <tbody>
              {data.permissionsMatrix.map((row) => (
                <tr key={row.capability}>
                  <td>{row.capability}</td>
                  {["OWNER", "ADMIN", "MEMBER", "VIEWER"].map((r) => (
                    <td key={r}>
                      {row[r] ? (
                        <Check size={15} color="#10b981" style={{ display: "inline" }} />
                      ) : (
                        <span style={{ color: "#52525b" }}>—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
