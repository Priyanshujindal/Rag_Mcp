import test from "node:test";
import assert from "node:assert/strict";
import {
  splitTableRow,
  isTableDelimiter,
  getAlignment,
  parseMarkdownTable,
} from "../src/lib/utils/markdown-table.js";

// ── Test Suite 1: splitTableRow ─────────────────────────────────────────────

test("splitTableRow splits cells and handles outer pipes", () => {
  // Standard with outer pipes
  assert.deepStrictEqual(splitTableRow("| Feature | MrBeast | Mr. Bean |"), [
    "Feature",
    "MrBeast",
    "Mr. Bean",
  ]);

  // Without outer pipes
  assert.deepStrictEqual(splitTableRow("Col 1 | Col 2 | Col 3"), [
    "Col 1",
    "Col 2",
    "Col 3",
  ]);

  // Escaped pipe characters inside cell content
  assert.deepStrictEqual(splitTableRow("| Operation | A \\| B | Result |"), [
    "Operation",
    "A | B",
    "Result",
  ]);

  // Empty cells
  assert.deepStrictEqual(splitTableRow("| A |  | C |"), ["A", "", "C"]);
});

// ── Test Suite 2: Delimiters and Alignments ───────────────────────────────────

test("isTableDelimiter identifies markdown separator rows", () => {
  assert.strictEqual(isTableDelimiter(["---", "---", "---"]), true);
  assert.strictEqual(isTableDelimiter([":---", ":---:", "---:"]), true);
  assert.strictEqual(isTableDelimiter(["--", ":-:", "-:"]), true);

  // Non-delimiters
  assert.strictEqual(isTableDelimiter(["Feature", "MrBeast"]), false);
  assert.strictEqual(isTableDelimiter([]), false);
  assert.strictEqual(isTableDelimiter(["---", "invalid"]), false);
});

test("getAlignment resolves column alignment correctly", () => {
  assert.strictEqual(getAlignment(":---"), "left");
  assert.strictEqual(getAlignment("---"), "left");
  assert.strictEqual(getAlignment(":---:"), "center");
  assert.strictEqual(getAlignment(":-:"), "center");
  assert.strictEqual(getAlignment("---:"), "right");
  assert.strictEqual(getAlignment("-:"), "right");
});

// ── Test Suite 3: parseMarkdownTable Full Extraction ────────────────────────

test("parseMarkdownTable parses standard contiguous comparison table", () => {
  const markdown = [
    "Quick Comparison Table",
    "| Feature | MrBeast | Mr. Bean |",
    "| :--- | :--- | :--- |",
    "| Real Identity | Jimmy Donaldson (Real human being) | Played by Rowan Atkinson (Fictional character) |",
    "| Origin / Era | United States (2010s – present) | United Kingdom (1990s – present) |",
    "| Primary Medium | YouTube, social media, digital streaming | Television, film, animated series |",
    "| Genre | Reality challenges, philanthropy, viral stunts | Slapstick, physical comedy, visual humor |",
    "| Communication | Loud, fast-paced, highly verbal | Almost entirely non-verbal / silent |",
    "| Core Motive | Giving away money, surviving extreme challenges | Navigating everyday, mundane tasks |",
    "| Sidekick / Prop | Real-life friends (Karl, Chandler) | Teddy and a green Mini Cooper |",
    "",
    "Next paragraph content here.",
  ];

  // Starting at index 0 (not a table)
  assert.strictEqual(parseMarkdownTable(markdown, 0), null);

  // Starting at index 1 (table header)
  const result = parseMarkdownTable(markdown, 1);
  assert.ok(result !== null);
  assert.deepStrictEqual(result.headers, ["Feature", "MrBeast", "Mr. Bean"]);
  assert.deepStrictEqual(result.alignments, ["left", "left", "left"]);
  assert.strictEqual(result.rows.length, 7);
  assert.strictEqual(result.rows[0][0], "Real Identity");
  assert.strictEqual(result.rows[0][1], "Jimmy Donaldson (Real human being)");
  assert.strictEqual(result.rows[0][2], "Played by Rowan Atkinson (Fictional character)");
  assert.strictEqual(result.rows[6][0], "Sidekick / Prop");
  assert.strictEqual(result.endIndex, 9);
});

test("parseMarkdownTable parses table with blank lines between rows", () => {
  // Common when LLMs stream or format with extra double-newlines
  const markdown = [
    "| Feature | MrBeast | Mr. Bean |",
    "",
    "| :--- | :---: | ---: |",
    "",
    "| Real Identity | Jimmy Donaldson | Rowan Atkinson |",
    "",
    "| Origin / Era | United States | United Kingdom |",
  ];

  const result = parseMarkdownTable(markdown, 0);
  assert.ok(result !== null);
  assert.deepStrictEqual(result.headers, ["Feature", "MrBeast", "Mr. Bean"]);
  assert.deepStrictEqual(result.alignments, ["left", "center", "right"]);
  assert.strictEqual(result.rows.length, 2);
  assert.strictEqual(result.rows[0][0], "Real Identity");
  assert.strictEqual(result.rows[1][0], "Origin / Era");
  assert.strictEqual(result.endIndex, 6);
});

test("parseMarkdownTable ignores non-table lines with pipes", () => {
  const codeLines = [
    "Run this shell command: `cat log.txt | grep error | wc -l`",
    "And then check the result.",
  ];

  assert.strictEqual(parseMarkdownTable(codeLines, 0), null);
});

