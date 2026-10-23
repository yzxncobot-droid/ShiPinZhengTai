const WEBHOOK_PATH = "/api/telegram/webhook";

function getPublicOrigin(value: string): string | null {
  try {
    const candidate = value.includes("://") ? value : `https://${value}`;
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();

    if (
      url.protocol !== "https:" ||
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".replit.dev")
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve a stable, public Telegram webhook endpoint.
 *
 * Development preview domains are deliberately excluded: Telegram cannot
 * reliably reach them and Replit may redirect them (307), which Telegram
 * treats as a delivery failure. A development server must not replace the
 * webhook registered by the published app.
 */
export function resolveTelegramWebhookUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicitBase = env.PUBLIC_BASE_URL?.trim();
  if (explicitBase) {
    const origin = getPublicOrigin(explicitBase);
    return origin ? `${origin}${WEBHOOK_PATH}` : null;
  }

  if (env.NODE_ENV !== "production") return null;

  for (const domain of (env.REPLIT_DOMAINS || "").split(",")) {
    const origin = getPublicOrigin(domain.trim());
    if (origin) return `${origin}${WEBHOOK_PATH}`;
  }

  return null;
}

/** Validate an explicit full endpoint entered through the admin setup route. */
export function normalizeTelegramWebhookEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    const origin = getPublicOrigin(url.origin);
    if (
      !origin ||
      url.pathname !== WEBHOOK_PATH ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `${origin}${WEBHOOK_PATH}`;
  } catch {
    return null;
  }
}
