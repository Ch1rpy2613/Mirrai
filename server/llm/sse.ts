/**
 * Minimal Server-Sent Events parsing shared by the streaming providers.
 *
 * The upstream APIs differ in framing (Claude uses named events, Dify uses a
 * single `data` field), but the wire format is the same, so the frame
 * splitting lives here once.
 */

/**
 * Yields the payload of every `data:` frame in an SSE response.
 *
 * Frames that arrive split across network chunks are buffered until complete;
 * comments (lines starting with `:`) and non-data fields are skipped.
 */
export async function* parseSSEData(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) throw new Error("Streaming response has no body");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line.
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        /**
         * A frame's data is every `data:` line in it, joined with a
         * newline.
         *
         * Each line used to be yielded on its own, so a payload split
         * over two `data:` lines was parsed as two frames: both failed
         * to parse, and the chunk was dropped without a sound.
         */
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          data.push(trimmed.slice(5).trim());
        }
        if (data.length > 0) yield data.join("\n");
      }
    }

    // Flush a trailing frame that arrived without its terminator.
    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      yield tail.slice(5).trim();
    }
  } finally {
    /**
     * The body is cancelled, not just unlocked.
     *
     * Releasing the lock hands the reader back but leaves the response
     * body unread. When a stream ends early — the caller stops reading,
     * or the retry in the LLM service starts a second request — undici
     * then holds the socket open until the provider times it out, so the
     * connection is not returned and the retry runs alongside the
     * abandoned one.
     */
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * Yields the `message.content` field of each line of a newline-delimited
 * JSON stream (the Ollama format).
 */
export async function* parseNDJSON(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) throw new Error("Streaming response has no body");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  /**
   * Reads the content of one NDJSON line.
   *
   * Returns an array rather than a generator: the project targets ES5, where
   * a generator cannot be iterated with `for...of`.
   */
  function readLine(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      const content = parsed?.message?.content;
      if (typeof content === "string" && content) return [content];
    } catch {
      // A malformed line is not fatal — skip it.
    }
    return [];
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        for (const content of readLine(line)) yield content;
      }
    }

    // Flush a trailing line that arrived without its newline terminator —
    // the SSE parser does the same, and dropping it would lose the last
    // chunk of a reply.
    for (const content of readLine(buffer)) yield content;
  } finally {
    // The body is cancelled, not just unlocked — see the note above.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
