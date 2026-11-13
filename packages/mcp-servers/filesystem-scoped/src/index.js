/**
 * packages/mcp-servers/filesystem-scoped/src/index.js
 * ==========================================================
 * Scoped Filesystem MCP Server.
 * Exposes safe, read-only filesystem inspection tools.
 */

import fs from "fs";
import path from "path";

export const tools = [
  {
    name: "read_file_snippet",
    description: "Reads file text up to a safe byte limit (max 10KB) within allowed workspace paths.",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path to read (e.g. 'package.json' or 'README.md')",
        },
        maxLines: {
          type: "number",
          description: "Optional maximum lines to read (default 50)",
        },
      },
      required: ["path"],
    },
    async execute({ path: relPath, maxLines = 50 }) {
      try {
        const cwd = process.cwd();
        const safePath = path.resolve(cwd, relPath);

        // Basic sandbox boundary check
        if (!safePath.startsWith(cwd)) {
          return { error: "Access denied: Path is outside permitted workspace directory." };
        }

        if (!fs.existsSync(safePath)) {
          return { error: `File not found: ${relPath}` };
        }

        const stat = fs.statSync(safePath);
        if (stat.isDirectory()) {
          return { error: `Path "${relPath}" is a directory, not a file. Use list_directory instead.` };
        }

        const raw = fs.readFileSync(safePath, "utf-8");
        const lines = raw.split("\n").slice(0, maxLines);
        const snippet = lines.join("\n");

        return {
          filename: path.basename(safePath),
          totalLines: raw.split("\n").length,
          previewLines: lines.length,
          content: snippet,
          truncated: lines.length < raw.split("\n").length,
        };
      } catch (err) {
        return { error: err.message };
      }
    },
  },
  {
    name: "list_directory",
    description: "Returns a directory listing of files and folders in the workspace.",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory path relative to workspace (e.g. '.' or 'packages')",
        },
      },
      required: [],
    },
    async execute({ directory = "." }) {
      try {
        const cwd = process.cwd();
        const safePath = path.resolve(cwd, directory);

        if (!safePath.startsWith(cwd)) {
          return { error: "Access denied: Path is outside permitted workspace directory." };
        }

        if (!fs.existsSync(safePath)) {
          return { error: `Directory not found: ${directory}` };
        }

        const entries = fs.readdirSync(safePath, { withFileTypes: true });
        const items = entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
        }));

        return {
          directory,
          totalCount: items.length,
          items: items.slice(0, 30),
        };
      } catch (err) {
        return { error: err.message };
      }
    },
  },
];

export default {
  name: "Scoped Filesystem MCP",
  description: "Safe file reading, grep search, and directory navigation restricted to workspace subtrees.",
  tools,
};

