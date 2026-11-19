/**
 * Utility functions for parsing Markdown tables.
 */

/**
 * Splits a table row into cells, handling unescaped pipe characters and outer edge pipes.
 */
export function splitTableRow(line) {
  let trimmed = (line || "").trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);

  const cells = [];
  let current = "";
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Checks if an array of cells forms a Markdown table delimiter row (e.g. `| :--- | :---: | ---: |`).
 */
export function isTableDelimiter(cells) {
  if (!cells || cells.length === 0) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
}

/**
 * Resolves cell alignment ("left", "center", "right") from a delimiter cell.
 */
export function getAlignment(cell) {
  const c = cell ? cell.trim() : "";
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

/**
 * Attempts to parse a Markdown table starting at startIndex.
 * Returns { headers, alignments, rows, endIndex } if successful, or null if not a table.
 */
export function parseMarkdownTable(rawLines, startIndex) {
  const headerLine = rawLines[startIndex]?.trim();
  if (!headerLine || !headerLine.includes("|")) return null;

  // Look ahead for delimiter row, tolerating optional blank line
  let delimiterIdx = -1;
  for (let k = startIndex + 1; k < rawLines.length; k++) {
    const nextL = rawLines[k].trim();
    if (!nextL) continue;
    const cells = splitTableRow(nextL);
    if (isTableDelimiter(cells)) {
      delimiterIdx = k;
    }
    break;
  }

  if (delimiterIdx === -1) return null;

  const headerCells = splitTableRow(headerLine);
  const delimiterCells = splitTableRow(rawLines[delimiterIdx].trim());
  const alignments = delimiterCells.map(getAlignment);

  const rows = [];
  let cursor = delimiterIdx + 1;

  while (cursor < rawLines.length) {
    const rowLine = rawLines[cursor].trim();
    if (!rowLine) {
      // Check if subsequent non-empty line is another table row
      let hasMore = false;
      for (let peek = cursor + 1; peek < rawLines.length; peek++) {
        const peekL = rawLines[peek].trim();
        if (!peekL) continue;
        if (
          peekL.includes("|") &&
          !peekL.startsWith("#") &&
          !/^(?:-{3,}|\*{3,}|_{3,})$/.test(peekL)
        ) {
          hasMore = true;
        }
        break;
      }
      if (hasMore) {
        cursor++;
        continue;
      } else {
        break;
      }
    }

    if (
      !rowLine.includes("|") ||
      rowLine.startsWith("#") ||
      /^(?:-{3,}|\*{3,}|_{3,})$/.test(rowLine)
    ) {
      break;
    }

    rows.push(splitTableRow(rowLine));
    cursor++;
  }

  return {
    headers: headerCells,
    alignments,
    rows,
    endIndex: cursor - 1,
  };
}

