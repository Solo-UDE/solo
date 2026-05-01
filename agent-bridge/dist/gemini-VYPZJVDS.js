import {
  createLogger
} from "./chunk-PI2SZOW3.js";

// src/providers/gemini.ts
var logger = createLogger("GeminiAdapter");
async function createGeminiSession(opts) {
  const { model, credentials, maxTokens } = opts;
  const apiKey = credentialToken(credentials);
  let pendingUserText = null;
  let abortController = null;
  let closed = false;
  const session = {
    provider: "gemini",
    sendMessage(text, _attachments) {
      if (closed) {
        logger.warn("sendMessage called on closed Gemini session \u2014 ignoring");
        return;
      }
      pendingUserText = text;
    },
    async *receiveResponse() {
      if (closed) {
        yield { type: "done", stopReason: "session_closed" };
        return;
      }
      if (pendingUserText === null) {
        logger.warn("receiveResponse called with no pending message");
        yield { type: "done", stopReason: "no_input" };
        return;
      }
      const userText = pendingUserText;
      pendingUserText = null;
      abortController = new AbortController();
      const startedAt = Date.now();
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model
          )}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            signal: abortController.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: userText }] }],
              generationConfig: maxTokens !== void 0 ? { maxOutputTokens: maxTokens } : void 0
            })
          }
        );
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error?.message ?? `Gemini request failed with ${response.status}`);
        }
        const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
        if (text) {
          yield { type: "text_delta", text };
        }
        const usage = json.usageMetadata;
        if (usage) {
          yield {
            type: "usage",
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0
          };
        }
        yield {
          type: "done",
          stopReason: json.candidates?.[0]?.finishReason ?? "end_turn",
          durationMs: Date.now() - startedAt
        };
      } catch (err) {
        if (abortController?.signal.aborted) {
          yield { type: "done", stopReason: "interrupted", durationMs: Date.now() - startedAt };
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "Gemini API error");
        throw err;
      } finally {
        abortController = null;
      }
    },
    async interrupt() {
      abortController?.abort();
    },
    async close() {
      closed = true;
      abortController?.abort();
    }
  };
  return session;
}
function credentialToken(credentials) {
  if (credentials.kind !== "api_key") {
    throw new Error("Gemini chat requires an API key credential.");
  }
  return credentials.token;
}
export {
  createGeminiSession
};
//# sourceMappingURL=gemini-VYPZJVDS.js.map