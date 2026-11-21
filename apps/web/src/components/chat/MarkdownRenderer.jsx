import React from "react";
import { CodeBlock } from "./CodeBlock";
import { parseMarkdownTable } from "../../lib/utils/markdown-table.js";

/**
 * Parses inline Markdown: bold (**text**), italic (*text*), inline code (`code`), 
 * links ([text](url)), citation tags ([1], [2]), line breaks (<br>), and HTML entities.
 */
function parseInline(text) {
  if (!text) return text;

  // Pattern matches:
  // 1. Line breaks: <br> or <br/>
  // 2. Links: [text](url)
  // 3. Bold: **text**
  // 4. Inline code: `code`
  // 5. Citation brackets: [1], [2], etc.
  // 6. Italic: *text* (when not bold)
  const regex = /(<br\s*\/?>|\[(.*?)\]\((.*?)\)|\*\*(.*?)\*\*|`([^`]+)`|\[(\d+)\]|\*([^*]+)\*)/gi;

  const parts = [];
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }

    if (match[1].toLowerCase().startsWith("<br")) {
      parts.push(<br key={`br-${match.index}`} />);
    } else if (match[1].startsWith("[") && match[3] !== undefined) {
      // Link [text](url)
      parts.push(
        <a
          key={match.index}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="chat-md-link"
        >
          {match[2]}
        </a>
      );
    } else if (match[4] !== undefined) {
      // Bold **text**
      parts.push(
        <strong key={match.index} className="chat-md-strong">
          {parseInline(match[4])}
        </strong>
      );
    } else if (match[5] !== undefined) {
      // Inline code `code`
      parts.push(
        <code key={match.index} className="chat-inline-code">
          {match[5]}
        </code>
      );
    } else if (match[6] !== undefined) {
      // Citation marker [1]
      parts.push(
        <span key={match.index} className="chat-inline-citation">
          [{match[6]}]
        </span>
      );
    } else if (match[7] !== undefined) {
      // Italic *text*
      parts.push(
        <em key={match.index} className="chat-md-em">
          {match[7]}
        </em>
      );
    }

    lastIdx = regex.lastIndex;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : parts;
}

/**
 * Splits raw content into block elements (Code blocks, Headers, Lists, Paragraphs, HRs, Tables).
 */
export function MarkdownRenderer({ content }) {
  if (!content) return null;

  // 1. Separate code fences ```lang\ncode\n```
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const blocks = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: "text",
        value: content.slice(lastIndex, match.index),
      });
    }
    blocks.push({
      type: "code",
      language: match[1] || "plaintext",
      code: match[2].trim(),
    });
    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    blocks.push({
      type: "text",
      value: content.slice(lastIndex),
    });
  }

  return (
    <div className="chat-markdown-container">
      {blocks.map((block, bIdx) => {
        if (block.type === "code") {
          return (
            <CodeBlock
              key={bIdx}
              code={block.code}
              language={block.language}
            />
          );
        }

        const rawLines = block.value.split("\n");
        const renderedElements = [];
        let currentList = null; // { type: 'ul' | 'ol', start: 1, items: [{ num: number, lines: [] }] }

        const flushList = () => {
          if (currentList) {
            if (currentList.type === "ul") {
              renderedElements.push(
                <ul key={`ul-${renderedElements.length}`} className="chat-md-ul">
                  {currentList.items.map((it, idx) => (
                    <li key={idx} className="chat-md-li">
                      {it.lines.map((ln, lIdx) => (
                        <div key={lIdx} className="chat-md-li-line">
                          {parseInline(ln)}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              );
            } else {
              renderedElements.push(
                <ol key={`ol-${renderedElements.length}`} start={currentList.start || 1} className="chat-md-ol">
                  {currentList.items.map((it, idx) => (
                    <li key={idx} value={it.num} className="chat-md-li">
                      {it.lines.map((ln, lIdx) => (
                        <div key={lIdx} className="chat-md-li-line">
                          {parseInline(ln)}
                        </div>
                      ))}
                    </li>
                  ))}
                </ol>
              );
            }
            currentList = null;
          }
        };

        for (let i = 0; i < rawLines.length; i++) {
          const line = rawLines[i].trim();
          if (!line) {
            // Check if this is a loose list where the next non-empty line is another item
            if (currentList) {
              let nextNonEmptyIdx = -1;
              for (let j = i + 1; j < rawLines.length; j++) {
                if (rawLines[j].trim()) {
                  nextNonEmptyIdx = j;
                  break;
                }
              }
              if (nextNonEmptyIdx !== -1) {
                const nextLine = rawLines[nextNonEmptyIdx].trim();
                const isNextItem =
                  (currentList.type === "ol" && /^\d+\.\s+/.test(nextLine)) ||
                  (currentList.type === "ul" && /^(\*|-|•)\s+/.test(nextLine));
                if (isNextItem) {
                  // Keep the list active across blank lines between items
                  continue;
                }
              }
            }
            flushList();
            continue;
          }

          // Horizontal rule
          if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
            flushList();
            renderedElements.push(
              <hr key={`hr-${i}`} className="chat-md-hr" />
            );
            continue;
          }

          // Headers
          if (line.startsWith("#### ")) {
            flushList();
            renderedElements.push(
              <h4 key={`h4-${i}`} className="chat-md-h4">
                {parseInline(line.slice(5))}
              </h4>
            );
            continue;
          }
          if (line.startsWith("### ")) {
            flushList();
            renderedElements.push(
              <h3 key={`h3-${i}`} className="chat-md-h3">
                {parseInline(line.slice(4))}
              </h3>
            );
            continue;
          }
          if (line.startsWith("## ")) {
            flushList();
            renderedElements.push(
              <h2 key={`h2-${i}`} className="chat-md-h2">
                {parseInline(line.slice(3))}
              </h2>
            );
            continue;
          }
          if (line.startsWith("# ")) {
            flushList();
            renderedElements.push(
              <h1 key={`h1-${i}`} className="chat-md-h1">
                {parseInline(line.slice(2))}
              </h1>
            );
            continue;
          }

          // Blockquote
          if (line.startsWith("> ")) {
            flushList();
            renderedElements.push(
              <blockquote key={`bq-${i}`} className="chat-md-blockquote">
                {parseInline(line.slice(2))}
              </blockquote>
            );
            continue;
          }

          // Unordered list (* item or - item or • item)
          const ulMatch = line.match(/^(\*|-|•)\s+(.*)/);
          if (ulMatch) {
            if (!currentList || currentList.type !== "ul") {
              flushList();
              currentList = { type: "ul", items: [] };
            }
            currentList.items.push({ lines: [ulMatch[2]] });
            continue;
          }

          // Ordered list (1. item, 2. item)
          const olMatch = line.match(/^(\d+)\.\s+(.*)/);
          if (olMatch) {
            const num = parseInt(olMatch[1], 10);
            if (!currentList || currentList.type !== "ol") {
              flushList();
              currentList = { type: "ol", start: num, items: [] };
            }
            currentList.items.push({ num, lines: [olMatch[2]] });
            continue;
          }

          // Markdown Table
          if (line.includes("|")) {
            const tableData = parseMarkdownTable(rawLines, i);
            if (tableData) {
              flushList();
              const { headers, alignments, rows, endIndex } = tableData;

              renderedElements.push(
                <div
                  key={`table-wrapper-${renderedElements.length}`}
                  className="chat-md-table-wrapper"
                >
                  <table className="chat-md-table">
                    <thead>
                      <tr className="chat-md-tr">
                        {headers.map((h, hIdx) => (
                          <th
                            key={hIdx}
                            style={{ textAlign: alignments[hIdx] || "left" }}
                            className="chat-md-th"
                          >
                            {parseInline(h)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rIdx) => (
                        <tr key={rIdx} className="chat-md-tr">
                          {headers.map((_, cIdx) => (
                            <td
                              key={cIdx}
                              style={{ textAlign: alignments[cIdx] || "left" }}
                              className="chat-md-td"
                            >
                              {parseInline(row[cIdx] || "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );

              i = endIndex;
              continue;
            }
          }

          // If inside an active list item, treat non-block lines as continuation of current item
          if (currentList && currentList.items.length > 0) {
            currentList.items[currentList.items.length - 1].lines.push(line);
            continue;
          }

          // Regular paragraph line
          flushList();
          renderedElements.push(
            <p key={`p-${i}`} className="chat-md-p">
              {parseInline(line)}
            </p>
          );
        }

        flushList();

        return <React.Fragment key={bIdx}>{renderedElements}</React.Fragment>;
      })}
    </div>
  );
}

export default MarkdownRenderer;

