// Kiro's stream-json output as the hosts read it: one JSON event a line, of which they keep tool titles. A tool result
// can make one very long line: kiro-cli 2.24 echoes an image its read tool opened as the image's bytes in a JSON array,
// about 3.6 characters a byte, so a review round of four 1440-pixel captures came to some 9 MB in one line, and the
// game host, which capped the whole output at 6 MB, stopped the arm in the middle of its review (October 6, 2026).
// Such lines are now skipped whole, and the output limit only bounds a runaway session.

import { StringDecoder } from 'node:string_decoder';

export const KIRO_OUTPUT_LIMITS = Object.freeze({ line: 1_000_000, total: 256_000_000 });

/** The update a stream-json event carries: ACP's params.update, kiro-cli 2.24's data.update, or the event itself. */
export const streamUpdate = event => event?.params?.update || event?.data?.update || event?.update || event;

/**
 * A reader for Kiro's standard output, fed one chunk at a time: `onLine` receives each complete line of at most
 * `limits.line` characters, and longer lines are dropped whole, each reported once to `onDrop`. `onLimit` is called
 * once the output passes `limits.total` bytes, after which the reader ignores the rest.
 */
export function kiroOutputReader({ onLine, onLimit, onDrop, limits = KIRO_OUTPUT_LIMITS }) {
  const decoder = new StringDecoder('utf8');
  let buffer = '', skipping = false, total = 0, limited = false;
  return chunk => {
    if (limited) return;
    total += chunk.length;
    if (total > limits.total) { limited = true; onLimit?.(); return; }
    let text = decoder.write(chunk);
    for (let newline = text.indexOf('\n'); newline >= 0; newline = text.indexOf('\n')) {
      const piece = text.slice(0, newline);
      text = text.slice(newline + 1);
      if (skipping) skipping = false;
      else if (buffer.length + piece.length <= limits.line) onLine(buffer + piece);
      else onDrop?.();
      buffer = '';
    }
    if (skipping) return;
    buffer += text;
    if (buffer.length > limits.line) { buffer = ''; skipping = true; onDrop?.(); }
  };
}
