/**
 * Probe a Telegram stream URL to retrieve the real backend error message.
 *
 * The native <video> element fires `error.code = 4` (MEDIA_ERR_NETWORK) for
 * ANY non-2xx stream response, but it cannot expose the HTTP status or the
 * response body. So when playback fails the user only sees a cryptic
 * "Error code: 4" — never the actual reason (e.g. "File terlaku besar untuk
 * Bot API", "Token belum dikonfigurasi", "File ID kadaluarsa").
 *
 * This helper makes a lightweight Range request to the same stream URL and
 * reads the backend's JSON error so the user sees the real cause. It is only
 * called AFTER the <video> has already errored (or timed out), so it does not
 * add overhead to the normal playback path.
 *
 * Returns the human-readable error string, or null when the stream responds
 * OK (the failure was transient) or the probe itself failed (network error).
 */
export async function probeStreamError(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    if (res.ok) {
      // Stream is reachable — the video error was transient. Don't read the
      // (potentially large) body; release the connection immediately.
      res.body?.cancel().catch(() => {});
      return null;
    }
    const data = await res.json().catch(() => null);
    if (data?.error) {
      return data.detail ? `${data.error} — ${data.detail}` : data.error;
    }
    return `HTTP ${res.status}`;
  } catch {
    return null;
  }
}
