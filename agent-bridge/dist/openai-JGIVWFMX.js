import {
  createLogger
} from "./chunk-PI2SZOW3.js";

// src/providers/openai.ts
import OpenAI from "openai";
var logger = createLogger("OpenAIAdapter");
var CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";
var API_BASE_URL = "https://api.openai.com/v1";
async function createOpenAISession(opts) {
  const { model, credentials, maxTokens, thinkingEnabled } = opts;
  const client = buildClient(credentials);
  let pendingUserText = null;
  let abortController = null;
  let closed = false;
  const session = {
    provider: "openai",
    sendMessage(text, _attachments) {
      if (closed) {
        logger.warn("sendMessage called on closed OpenAI session \u2014 ignoring");
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
      try {
        const requestBody = {
          model,
          input: userText,
          stream: true,
          tools: []
        };
        if (maxTokens !== void 0) {
          requestBody.max_output_tokens = maxTokens;
        }
        if (thinkingEnabled === true) {
          requestBody.reasoning = { effort: "medium" };
        }
        const stream = await client.responses.create(
          requestBody,
          { signal: abortController.signal }
        );
        let sawDone = false;
        for await (const event of stream) {
          if (abortController?.signal.aborted) {
            yield { type: "done", stopReason: "interrupted" };
            sawDone = true;
            return;
          }
          const ev = translateEvent(event);
          if (ev) {
            if (ev.type === "done") sawDone = true;
            yield ev;
          }
        }
        if (!sawDone) {
          yield { type: "done", stopReason: "end_turn" };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "OpenAI Responses API error");
        throw err;
      } finally {
        abortController = null;
      }
    },
    async interrupt() {
      if (abortController) {
        abortController.abort();
      }
    },
    async close() {
      closed = true;
      if (abortController) {
        abortController.abort();
      }
    }
  };
  return session;
}
function buildClient(credentials) {
  switch (credentials.kind) {
    case "oauth": {
      const defaultHeaders = {};
      if (credentials.accountId) {
        defaultHeaders["chatgpt-account-id"] = credentials.accountId;
      }
      return new OpenAI({
        apiKey: credentials.token,
        baseURL: CHATGPT_BASE_URL,
        defaultHeaders
      });
    }
    case "api_key":
      return new OpenAI({
        apiKey: credentials.token,
        baseURL: API_BASE_URL
      });
  }
}
function translateEvent(event) {
  const type = event.type;
  switch (type) {
    case "response.output_text.delta": {
      const delta = event.delta;
      return typeof delta === "string" && delta !== "" ? { type: "text_delta", text: delta } : null;
    }
    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta": {
      const delta = event.delta;
      return typeof delta === "string" && delta !== "" ? { type: "thinking_delta", text: delta } : null;
    }
    case "response.completed": {
      const response = event.response;
      const usage = response?.usage;
      if (usage) {
        const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
        const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
        return { type: "usage", inputTokens, outputTokens };
      }
      return null;
    }
    default:
      return null;
  }
}
export {
  createOpenAISession
};
//# sourceMappingURL=openai-JGIVWFMX.js.map