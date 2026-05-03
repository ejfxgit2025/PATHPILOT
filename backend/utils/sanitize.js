/**
 * PathPilot — Input Sanitization Utility
 * ─────────────────────────────────────────────────────────────────────────────
 * Prevents "Cannot convert argument to a ByteString because character 8212"
 * and similar Unicode-related OpenRouter fetch failures.
 *
 * Every byte that leaves this file is guaranteed ASCII-safe.
 */

/**
 * Sanitize a prompt or page-text string before sending to any AI model.
 *
 * Transformations applied (in order):
 *   1. Em-dash / en-dash  → hyphen
 *   2. Smart double-quotes → straight double-quotes
 *   3. Smart single-quotes / apostrophes → straight apostrophe
 *   4. Ellipsis character  → three dots
 *   5. Non-breaking space  → regular space
 *   6. Any remaining non-ASCII codepoint → space
 *   7. Collapse whitespace runs → single space
 *   8. Trim leading/trailing whitespace
 *
 * @param {string} text - Raw input that may contain non-ASCII characters.
 * @returns {string} ASCII-safe string ready for ByteString conversion.
 */
export function sanitizeInput(text) {
  if (!text) return '';

  return text
    // Em-dash (U+2014) and en-dash (U+2013) → hyphen
    .replace(/[\u2013\u2014]/g, '-')
    // Smart double-quotes (U+201C / U+201D) → straight double-quote
    .replace(/[\u201C\u201D]/g, '"')
    // Smart single-quotes / apostrophes (U+2018 / U+2019) → straight apostrophe
    .replace(/[\u2018\u2019]/g, "'")
    // Horizontal ellipsis (U+2026) → three dots
    .replace(/\u2026/g, '...')
    // Non-breaking space (U+00A0) → regular space
    .replace(/\u00A0/g, ' ')
    // Strip all remaining non-ASCII codepoints (emoji, CJK, etc.) → space
    .replace(/[^\x00-\x7F]/g, ' ')
    // Collapse multiple whitespace (spaces, tabs, newlines) → single space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lightweight sanitizer for page-scraped text (content scripts / background).
 * Faster than sanitizeInput — skips quote normalisation, just strips non-ASCII.
 *
 * @param {string} text - Raw page text from DOM extraction.
 * @returns {string} ASCII-safe page text.
 */
export function cleanPageText(text) {
  if (!text) return '';

  return text
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
