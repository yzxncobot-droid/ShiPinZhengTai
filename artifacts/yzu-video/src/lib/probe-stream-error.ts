/**
 * Probe a Telegram stream after the native player fails. Do not expose raw
 * server error details here: upstream errors can contain internal identifiers.
 * Returns a safe user-facing message for HTTP/media-response failures, or
 * null when the response looks like a video stream or the probe itself fails.
 */
export async function probeStreamError(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-15" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const messages: Record<number, string> = {
        401: "Sesi pemutaran tidak berlaku. Muat ulang halaman dan masuk kembali.",
        403: "Akun ini tidak memiliki akses untuk memutar video.",
        404: "File video tidak ditemukan atau sudah dihapus.",
        416: "Server menolak rentang data video. Muat ulang halaman untuk mencoba lagi.",
        429: "Server sedang menangani banyak permintaan. Tunggu sebentar lalu coba lagi.",
      };
      const message = messages[res.status] ??
        (res.status >= 500
          ? "Server streaming sedang mengalami gangguan. Coba lagi sebentar."
          : "Server menolak permintaan pemutaran video.");
      await res.body?.cancel().catch(() => {});
      return message;
    }

    const contentType = res.headers.get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    const contentRange = res.headers.get("content-range");
    if (!contentType?.startsWith("video/")) {
      await res.body?.cancel().catch(() => {});
      return "Server tidak mengembalikan format video yang dikenali.";
    }
    if (res.status === 206 && !/^bytes 0-15\/[1-9]\d*$/.test(contentRange ?? "")) {
      await res.body?.cancel().catch(() => {});
      return "Respons streaming memiliki rentang byte yang tidak valid.";
    }
    if (res.status !== 200 && res.status !== 206) {
      await res.body?.cancel().catch(() => {});
      return "Server mengembalikan respons streaming yang tidak valid.";
    }

    const reader = res.body?.getReader();
    if (!reader) return "Server tidak mengirim data video.";
    let sample: Uint8Array | undefined;
    try {
      sample = (await reader.read()).value;
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (!sample?.byteLength) return "Server mengirim file video kosong.";

    const prefix = new TextDecoder().decode(sample.subarray(0, 16)).trimStart();
    if (prefix.startsWith("<") || prefix.startsWith("{") || prefix.startsWith("[")) {
      return "Server mengembalikan halaman atau data error, bukan file video.";
    }
    if (
      contentType === "video/mp4" &&
      (sample.byteLength < 8 || new TextDecoder().decode(sample.subarray(4, 8)) !== "ftyp")
    ) {
      return "Data yang dikirim tidak memiliki struktur kontainer MP4 yang valid.";
    }

    // HTTP is healthy; the browser may still have rejected the media codec or
    // container, so the caller should report the native MediaError separately.
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
