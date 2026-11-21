/**
 * apps/api/src/utils/ssrf-guard.js
 * ================================
 * Server-Side Request Forgery (SSRF) Guard for remote MCP server endpoints.
 * Blocks:
 *   - Non-HTTP(S) protocols
 *   - Localhost / loopback addresses (127.0.0.0/8, ::1)
 *   - RFC 1918 Private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 *   - Link-local addresses (169.254.0.0/16 - cloud metadata e.g. AWS/GCP/Azure)
 *   - Broadcast and reserved addresses
 */

import dns from "dns/promises";
import net from "net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "instance-data",
]);

function isPrivateIp(ip) {
  if (!ip) return true;

  // IPv4 Loopback
  if (ip.startsWith("127.")) return true;

  // IPv4 RFC 1918 Private
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;

  // Link-local / Cloud Metadata (169.254.x.x)
  if (ip.startsWith("169.254.")) return true;

  // Broadcast / Zero
  if (ip === "0.0.0.0" || ip === "255.255.255.255") return true;

  // IPv6 checks
  if (ip === "::1" || ip === "::" || ip.toLowerCase().startsWith("fe80:") || ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd")) {
    return true;
  }

  return false;
}

export async function validateRemoteMcpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Invalid MCP server URL provided");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Malformed MCP server URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Forbidden protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted for remote MCP servers.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`Connection to "${hostname}" is blocked for security (SSRF prevention).`);
  }

  // Check if hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`IP address "${hostname}" is private or reserved and cannot be accessed.`);
    }
    return parsed.toString();
  }

  // Resolve hostname via DNS to prevent DNS rebinding to internal network
  try {
    const lookup = await dns.lookup(hostname, { all: true });
    for (const record of lookup) {
      if (isPrivateIp(record.address)) {
        throw new Error(
          `Destination "${hostname}" resolves to private address "${record.address}", which is blocked.`
        );
      }
    }
  } catch (err) {
    if (err.code === "ENOTFOUND") {
      throw new Error(`Could not resolve MCP server hostname: "${hostname}"`);
    }
    throw err;
  }

  return parsed.toString();
}

export default {
  validateRemoteMcpUrl,
};
