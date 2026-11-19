/**
 * packages/mcp-servers/demo-tools/src/index.js
 * ==========================================================
 * Demo Tools & SQL Analytics MCP Server.
 * Exposes database queries (requiring approval) and analytical calculators.
 */

// Simulated PostgreSQL analytics replica tables
const DB_TABLES = {
  orders: [
    { id: "ord_101", customer: "Acme Corp", plan: "Enterprise", amount: 4800, status: "PAID", date: "2026-11-01" },
    { id: "ord_102", customer: "Globex Ltd", plan: "Pro", amount: 1200, status: "PAID", date: "2026-11-03" },
    { id: "ord_103", customer: "Initech Systems", plan: "Starter", amount: 299, status: "PENDING", date: "2026-11-05" },
    { id: "ord_104", customer: "Umbrella Tech", plan: "Enterprise", amount: 9600, status: "PAID", date: "2026-11-06" },
  ],
  customers: [
    { id: "cust_1", name: "Acme Corp", email: "billing@acme.com", country: "US", activeSince: "2025-02-15" },
    { id: "cust_2", name: "Globex Ltd", email: "ops@globex.co.uk", country: "UK", activeSince: "2025-08-10" },
    { id: "cust_3", name: "Initech Systems", email: "peter@initech.io", country: "US", activeSince: "2026-01-20" },
  ],
};

export const tools = [
  {
    name: "execute_readonly_sql",
    description: "Runs read-only SQL queries against the analytical replica database (tables: orders, customers). Requires human-in-the-loop approval before executing.",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Read-only SQL query (e.g. 'SELECT * FROM orders WHERE status = \\'PAID\\';')",
        },
      },
      required: ["query"],
    },
    async execute({ query }) {
      const q = (query || "").trim();
      const upper = q.toUpperCase();

      if (!upper.startsWith("SELECT")) {
        return { error: "Security restriction: Only SELECT queries are permitted on the analytics replica." };
      }

      // Simple mock parser for orders or customers
      let rows = [];
      if (upper.includes("FROM ORDERS")) {
        rows = DB_TABLES.orders;
        if (upper.includes("STATUS = 'PAID'") || upper.includes("STATUS='PAID'")) {
          rows = rows.filter((r) => r.status === "PAID");
        }
      } else if (upper.includes("FROM CUSTOMERS")) {
        rows = DB_TABLES.customers;
      } else {
        rows = [
          ...DB_TABLES.orders.map((o) => ({ type: "order", ...o })),
        ];
      }

      return {
        queryExecuted: q,
        rowCount: rows.length,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        data: rows,
      };
    },
  },
  {
    name: "calculate_metrics",
    description: "Evaluates exact mathematical operations, percentage changes, or KPI ratios.",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Math formula (e.g. '(4800 + 1200 + 9600) / 3' or '(9600 - 4800) / 4800 * 100')",
        },
        description: {
          type: "string",
          description: "Optional description of what is being measured",
        },
      },
      required: ["expression"],
    },
    async execute({ expression, description = "" }) {
      try {
        // Safe evaluation of basic arithmetic
        const sanitized = expression.replace(/[^0-9+\-*/().% ]/g, "");
        if (!sanitized.trim()) {
          return { error: "Invalid math expression." };
        }
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${sanitized});`)();
        return {
          metric: description || "Calculated Value",
          expression: sanitized,
          value: Number(result.toFixed(4)),
        };
      } catch (err) {
        return { error: `Calculation failed: ${err.message}` };
      }
    },
  },
];

export default {
  name: "PostgreSQL Analytics MCP",
  description: "Read-only SQL executor for querying application metrics and customer segments.",
  tools,
};

