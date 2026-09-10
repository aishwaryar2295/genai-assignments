// GitHub Code Reviewer Agent — AI Tester
// Minimal, dependency-free Markdown -> safe HTML renderer for the n8n review response.
// All source text is HTML-escaped before any tag is introduced, so untrusted content
// can never inject markup or scripts; malformed fragments fall back to plain paragraphs.
(function (global) {
  "use strict";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Applies inline formatting to text that has already been HTML-escaped.
  function renderInline(escapedText) {
    var result = escapedText;
    result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
    result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    result = result.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    result = result.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, "$1<em>$2</em>");
    return result;
  }

  function isTableSeparatorRow(line) {
    var cells = splitTableRow(line);
    return cells.length > 1 && cells.every(function (cell) {
      return /^:?-{1,}:?$/.test(cell.replace(/\s/g, ""));
    });
  }

  function splitTableRow(line) {
    var trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map(function (cell) {
      return cell.trim();
    });
  }

  function normalizeReviewTableRows(lines) {
    var rows = [];
    var currentRow = null;

    lines.forEach(function (line) {
      var rowStart = /^\s*\|\s*\*\*([^|]+)\*\*\s*\|\s*(.*)$/.exec(line);
      if (rowStart) {
        if (currentRow) {
          rows.push(currentRow);
        }
        var inlineScore = /^(.*)\|\s*\*\*(\d+)\*\*\s*\|?\s*$/.exec(rowStart[2].trim());
        currentRow = [
          rowStart[1].trim(),
          inlineScore ? inlineScore[1].trim() : rowStart[2].trim(),
          inlineScore ? inlineScore[2] : ""
        ];
        return;
      }

      if (!currentRow) {
        return;
      }

      var scoreMatch = /^[\s\S]*?(?:\|\s*\*\*(\d+)\*\*\s*\|?)\s*$/.exec(currentRow[1] + "\n" + line.trim());
      if (scoreMatch) {
        currentRow[1] = (currentRow[1] + "\n" + line.trim()).replace(/\|\s*\*\*\d+\*\*\s*\|?\s*$/, "").trim();
        currentRow[2] = scoreMatch[1];
      } else {
        currentRow[1] += "\n" + line.trim();
      }
    });

    if (currentRow) {
      rows.push(currentRow);
    }

    return rows;
  }

  // Returns null when column counts are inconsistent, signalling the caller to fall back.
  function renderTable(headerLine, bodyLines) {
    var headerCells = splitTableRow(headerLine);
    var expectedColumns = headerCells.length;
    var reviewRows = normalizeReviewTableRows(bodyLines);

    if (expectedColumns === 3 && reviewRows.length > 0) {
      var reviewHtml = '<div class="md-table-wrapper"><table class="md-table"><thead><tr>';
      headerCells.forEach(function (cell) {
        reviewHtml += "<th>" + renderInline(escapeHtml(cell)) + "</th>";
      });
      reviewHtml += "</tr></thead><tbody>";

      reviewRows.forEach(function (row) {
        reviewHtml += "<tr><td><strong>" + escapeHtml(row[0]) + "</strong></td>";
        reviewHtml += "<td>" + renderInline(escapeHtml(row[1]).replace(/\n/g, "<br />")) + "</td>";
        reviewHtml += "<td>" + escapeHtml(row[2]) + "</td></tr>";
      });

      reviewHtml += "</tbody></table></div>";
      return reviewHtml;
    }

    var multilineRows = normalizeMultilineTableRows(bodyLines, expectedColumns);
    if (multilineRows.length > 0) {
      var multilineHtml = '<div class="md-table-wrapper"><table class="md-table"><thead><tr>';
      headerCells.forEach(function (cell) {
        multilineHtml += "<th>" + renderInline(escapeHtml(cell)) + "</th>";
      });
      multilineHtml += "</tr></thead><tbody>";

      multilineRows.forEach(function (row) {
        multilineHtml += "<tr>";
        row.forEach(function (cell) {
          multilineHtml += "<td>" + renderInline(escapeHtml(cell).replace(/\n/g, "<br />")) + "</td>";
        });
        multilineHtml += "</tr>";
      });

      multilineHtml += "</tbody></table></div>";
      return multilineHtml;
    }

    var isConsistent = bodyLines.every(function (line) {
      return splitTableRow(line).length === expectedColumns;
    });

    if (!isConsistent) {
      return null;
    }

    var html = '<div class="md-table-wrapper"><table class="md-table"><thead><tr>';
    headerCells.forEach(function (cell) {
      html += "<th>" + renderInline(escapeHtml(cell)) + "</th>";
    });
    html += "</tr></thead><tbody>";

    bodyLines.forEach(function (line) {
      html += "<tr>";
      splitTableRow(line).forEach(function (cell) {
        html += "<td>" + renderInline(escapeHtml(cell)) + "</td>";
      });
      html += "</tr>";
    });

    html += "</tbody></table></div>";
    return html;
  }

  function normalizeMultilineTableRows(lines, expectedColumns) {
    var rows = [];
    var currentRow = null;

    lines.forEach(function (line) {
      if (line.trim().charAt(0) === "|") {
        var cells = splitTableRow(line);
        if (cells.length === expectedColumns) {
          if (currentRow) {
            rows.push(currentRow);
          }
          currentRow = cells;
          return;
        }
      }

      if (currentRow) {
        currentRow[currentRow.length - 1] += "\n" + line.trim().replace(/\|\s*$/, "");
      }
    });

    if (currentRow) {
      rows.push(currentRow);
    }

    return rows.filter(function (row) {
      return row.some(function (cell) {
        return cell.trim() !== "";
      });
    });
  }

  function render(rawText) {
    var text = normalizeReviewText(rawText);
    var lines = text.split("\n");
    var htmlParts = [];
    var paragraphBuffer = [];
    var i = 0;

    function flushParagraph() {
      if (paragraphBuffer.length === 0) {
        return;
      }
      var joined = paragraphBuffer
        .map(function (line) {
          return renderInline(escapeHtml(line));
        })
        .join("<br />");
      htmlParts.push("<p>" + joined + "</p>");
      paragraphBuffer = [];
    }

    while (i < lines.length) {
      var line = lines[i];

      // Fenced code block: render captured lines even if the closing fence is missing.
      if (/^\s*```/.test(line)) {
        flushParagraph();
        var codeLines = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          i++;
        }
        htmlParts.push('<pre class="md-code-block"><code>' + escapeHtml(codeLines.join("\n")) + "</code></pre>");
        continue;
      }

      // Horizontal rule
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
        flushParagraph();
        htmlParts.push("<hr />");
        i++;
        continue;
      }

      // Heading
      var headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
      if (headingMatch) {
        flushParagraph();
        var level = headingMatch[1].length;
        htmlParts.push("<h" + level + ">" + renderInline(escapeHtml(headingMatch[2].trim())) + "</h" + level + ">");
        i++;
        continue;
      }

      // Table: a row containing "|" immediately followed by a separator row
      if (line.indexOf("|") !== -1 && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
        var bodyLines = [];
        var j = i + 2;
        while (j < lines.length && lines[j].trim() !== "") {
          bodyLines.push(lines[j]);
          j++;
        }
        var tableHtml = renderTable(line, bodyLines);
        if (tableHtml) {
          flushParagraph();
          htmlParts.push(tableHtml);
          i = j;
          continue;
        }
        // Malformed table: fall through to paragraph handling below.
      }

      // Unordered list
      if (/^\s*[-*+]\s+/.test(line)) {
        flushParagraph();
        var ulItems = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          ulItems.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
          i++;
        }
        htmlParts.push(
          "<ul>" +
            ulItems
              .map(function (item) {
                return "<li>" + renderInline(escapeHtml(item)) + "</li>";
              })
              .join("") +
            "</ul>"
        );
        continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        flushParagraph();
        var olItems = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          olItems.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
          i++;
        }
        htmlParts.push(
          "<ol>" +
            olItems
              .map(function (item) {
                return "<li>" + renderInline(escapeHtml(item)) + "</li>";
              })
              .join("") +
            "</ol>"
        );
        continue;
      }

      // Blank line ends the current paragraph
      if (line.trim() === "") {
        flushParagraph();
        i++;
        continue;
      }

      paragraphBuffer.push(line);
      i++;
    }

    flushParagraph();

    return htmlParts.join("\n");
  }

  function normalizeReviewText(rawText) {
    var text = String(rawText == null ? "" : rawText);

    // n8n responses may contain escaped line breaks or presentation-only HTML tags.
    text = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
    text = text.replace(/<br\s*\/?>/gi, "\n");
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  global.SimpleMarkdown = { render: render };
})(window);
