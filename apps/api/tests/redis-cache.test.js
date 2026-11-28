import { describe, it, expect } from "vitest";
import { cacheSet, cacheGet, cacheDel, isRedisReady } from "../src/lib/redis.js";

describe("Redis client & fallback cache", () => {
  it("reports fallback mode when Redis is not connected in test", () => {
    expect(isRedisReady()).toBe(false);
  });

  it("stores, retrieves, and deletes JSON values via in-memory fallback", async () => {
    const key = "test:oauth:state:abc";
    const value = { integrationId: "google-drive", userId: "u123" };

    await cacheSet(key, value, 60);
    const loaded = await cacheGet(key);
    expect(loaded).toEqual(value);

    await cacheDel(key);
    const afterDelete = await cacheGet(key);
    expect(afterDelete).toBeNull();
  });
});
