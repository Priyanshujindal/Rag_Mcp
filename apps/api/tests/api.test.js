import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import config from "../src/config/index.js";
import { connectDb, extractSafeHost } from "../src/db/connection.js";

describe("API Foundation & Skeleton (Stage 1)", () => {
  describe("GET /health", () => {
    it("returns 200 with status ok and ISO timestamp", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("status", "ok");
      expect(res.body).toHaveProperty("timestamp");
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });
  });

  describe("404 Error Envelope", () => {
    it("returns 404 with standardized error envelope for unknown routes", async () => {
      const res = await request(app).get("/api/v1/unknown-path-does-not-exist");
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toHaveProperty("code", "NOT_FOUND");
      expect(res.body.error).toHaveProperty("message");
      expect(res.body.error.message).toContain("not found");
    });
  });

  describe("ObjectId Validation & Route Param Handling", () => {
    it("returns 404 (never 500) when an invalid ObjectId is passed in a route parameter", async () => {
      const res = await request(app).get("/api/v1/test-resource/invalid-id-xyz");
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toHaveProperty("code", "NOT_FOUND");
      expect(res.body.error.message).toBe("Resource not found");
    });

    it("accepts a valid 24-character hexadecimal ObjectId", async () => {
      const validObjectId = "507f1f77bcf86cd799439011";
      const res = await request(app).get(`/api/v1/test-resource/${validObjectId}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: validObjectId });
    });
  });

  describe("Zod Validation & Strict Schemas", () => {
    it("returns 422 with field-level details on missing required fields or unknown fields", async () => {
      const res = await request(app)
        .post("/api/v1/test-resource")
        .send({ unknownField: "unexpected" });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toHaveProperty("code", "UNPROCESSABLE_ENTITY");
      expect(res.body.error).toHaveProperty("details");
      expect(Array.isArray(res.body.error.details)).toBe(true);
    });

    it("succeeds when valid payload matching strict schema is sent", async () => {
      const res = await request(app)
        .post("/api/v1/test-resource")
        .send({ name: "Knowledge Base A", count: 42 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        data: { name: "Knowledge Base A", count: 42 },
      });
    });
  });

  describe("NoSQL Injection Defense", () => {
    it("rejects request bodies containing keys starting with '$'", async () => {
      const res = await request(app)
        .post("/api/v1/test-resource")
        .send({ "$ne": null });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("keys starting with \"$\" or containing \".\" are not allowed");
    });

    it("rejects request bodies containing nested keys starting with '$'", async () => {
      const res = await request(app)
        .post("/api/v1/test-resource")
        .send({ name: { "$gt": "" } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });

    it("rejects queries containing keys with '.'", async () => {
      const res = await request(app)
        .get("/health?user.isAdmin=true");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });
  });

  describe("Shared Atlas Security & Test DB Safety Guard", () => {
    it("never leaks database username or password when logging cluster host", () => {
      const mockUri = "mongodb+srv://atlasUser:SuperSecretPassword123@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority";
      const safeHost = extractSafeHost(mockUri);

      expect(safeHost).toBe("cluster0.abcde.mongodb.net");
      expect(safeHost).not.toContain("atlasUser");
      expect(safeHost).not.toContain("SuperSecretPassword123");
    });

    it("throws immediately before connecting if test database does not end with '_test'", async () => {
      await expect(connectDb({ dbName: `${config.MONGODB_DB_NAME}_production` })).rejects.toThrow(
        /SAFETY VIOLATION: Test suite can only connect to databases ending with "_test"/
      );
    });

    it("throws immediately if test database equals the production database name", async () => {
      await expect(connectDb({ dbName: config.MONGODB_DB_NAME })).rejects.toThrow(
        /SAFETY VIOLATION/
      );
    });
  });
});

