import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("Google Sign-In auth endpoints", () => {
  const prevClientId = process.env.GOOGLE_CLIENT_ID;
  const prevClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  });

  afterEach(() => {
    if (prevClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prevClientId;
    if (prevClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = prevClientSecret;
  });

  it("GET /api/v1/auth/google returns a Google OAuth URL with state", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/auth/google?redirectUri=https://rag-mcp-seven.vercel.app/login");

    expect(res.status).toBe(200);
    expect(res.body.authUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(res.body.authUrl).toContain("client_id=test-google-client-id");
    expect(res.body.authUrl).toContain(encodeURIComponent("https://rag-mcp-seven.vercel.app/login"));
    expect(res.body.state).toBeTruthy();
  });

  it("POST /api/v1/auth/google/callback rejects invalid OAuth state", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/auth/google/callback")
      .send({ code: "dummy-code", state: "nonexistent-state" });

    expect(res.status).toBe(403);
  });
});
