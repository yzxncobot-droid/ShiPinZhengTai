import { describe, expect, it } from "vitest";
import {
  normalizeTelegramWebhookEndpoint,
  resolveTelegramWebhookUrl,
} from "../webhook-url";

describe("Telegram webhook URL resolution", () => {
  it("uses the published Replit domain and ignores development preview domains", () => {
    expect(resolveTelegramWebhookUrl({
      NODE_ENV: "production",
      REPLIT_DOMAINS: "preview.pike.replit.dev,x--app.replit.app",
    })).toBe("https://x--app.replit.app/api/telegram/webhook");
  });

  it("does not let a development server replace the published webhook", () => {
    expect(resolveTelegramWebhookUrl({
      NODE_ENV: "development",
      REPLIT_DOMAINS: "preview.pike.replit.dev",
    })).toBeNull();
  });

  it("prefers an explicit public base URL", () => {
    expect(resolveTelegramWebhookUrl({
      NODE_ENV: "development",
      PUBLIC_BASE_URL: "https://videos.example.com/",
      REPLIT_DOMAINS: "preview.pike.replit.dev",
    })).toBe("https://videos.example.com/api/telegram/webhook");
  });

  it("rejects insecure or development preview URLs", () => {
    expect(resolveTelegramWebhookUrl({
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "http://x--app.replit.app",
    })).toBeNull();
    expect(normalizeTelegramWebhookEndpoint(
      "https://preview.pike.replit.dev/api/telegram/webhook",
    )).toBeNull();
    expect(normalizeTelegramWebhookEndpoint(
      "https://x--app.replit.app/not-the-webhook",
    )).toBeNull();
  });

  it("accepts only the HTTPS public webhook endpoint", () => {
    expect(normalizeTelegramWebhookEndpoint(
      "https://x--app.replit.app/api/telegram/webhook",
    )).toBe("https://x--app.replit.app/api/telegram/webhook");
  });
});
