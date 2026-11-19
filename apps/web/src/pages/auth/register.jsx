import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { register } = useAuth();

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await register(form);
      navigate("/", { replace: true });
    } catch (err) {
      if (err.status === 429 || err.code === "RATE_LIMITED") {
        const retrySec = err.details?.retryAfterSeconds;
        setError(retrySec ? `${err.message} Please retry in ${retrySec}s.` : err.message);
      } else {
        setError(err.message || "Failed to create account.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-logo">
        <div className="auth-logo-icon">
          <Sparkles size={18} />
        </div>
        Rag_Mcp
      </div>

      <h1 className="auth-title">Create an account</h1>
      <p className="auth-subtitle">Start building AI chatbots today</p>

      {error && (
        <div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "16px", textAlign: "center" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="auth-form">
        <div className="form-row auth-form-row">
          <label htmlFor="reg-name" className="form-label">Full name</label>
          <input
            id="reg-name"
            className="input"
            type="text"
            name="name"
            placeholder="Priyanshu Jindal"
            value={form.name}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-row auth-form-row">
          <label htmlFor="reg-email" className="form-label">Email</label>
          <input
            id="reg-email"
            className="input"
            type="email"
            name="email"
            placeholder="you@example.com"
            value={form.email}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-row auth-form-row">
          <label htmlFor="reg-password" className="form-label">Password</label>
          <input
            id="reg-password"
            className="input"
            type="password"
            name="password"
            placeholder="Min 8 characters"
            value={form.password}
            onChange={handleChange}
            required
            minLength={8}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary auth-submit-btn"
          disabled={loading}
        >
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p className="auth-footer">
        Already have an account?{" "}
        <Link to="/login" className="auth-link">Sign in</Link>
      </p>
    </div>
  );
}
