import crypto from "crypto";
import config from "../config/index.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Returns a 32-byte Buffer key derived from ENCRYPTION_SECRET or JWT_ACCESS_SECRET.
 */
function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_SECRET || config.JWT_ACCESS_SECRET || "default_rag_mcp_secure_fallback_encryption_key_32_bytes";
  return crypto.createHash("sha256").update(String(secret)).digest();
}

/**
 * Encrypts plain text using AES-256-GCM.
 * Output format: iv:authTag:ciphertext (hex encoded)
 * @param {string} text
 * @returns {string}
 */
export function encryptToken(text) {
  if (!text) return text;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts ciphertext encrypted with AES-256-GCM.
 * @param {string} encryptedText - iv:authTag:ciphertext
 * @returns {string}
 */
export function decryptToken(encryptedText) {
  if (!encryptedText) return encryptedText;
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    // Return raw if it wasn't formatted as an encrypted string (e.g. legacy plain token)
    return encryptedText;
  }
  const [ivHex, authTagHex, encrypted] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
