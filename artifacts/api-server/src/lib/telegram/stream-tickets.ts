/**
 * Stream playback tickets (no expiry).
 *
 * A native HTML5 <video src=""> request cannot attach the Authorization
 * header that the API's Bearer-token auth requires, so the stream endpoint
 * also accepts a ?ticket= query parameter. The ticket is a JWT signed with
 * the SAME secret as the login tokens (JWT_SECRET / SESSION_SECRET).
 *
 * The ticket has NO expiry — the <video> element issues Range requests
 * throughout playback (buffering), so any TTL would eventually cause
 * "Invalid or expired stream ticket" mid-playback. This is safe because:
 *   - The ticket payload contains ONLY videoId + userId (no bot token,
 *     no file_id, no other credential).
 *   - Access (premium subscription + banned status) is re-verified from the
 *     database on EVERY stream request via checkTelegramVideoAccess and the
 *     banned-user check in streamAuth. A shared ticket only works while the
 *     user still legitimately has access.
 */
import jwt from "jsonwebtoken";
import { EFFECTIVE_JWT_SECRET } from "../../middlewares/auth";

export interface StreamTicketPayload {
  videoId: string;
  userId: string;
}

/** Issue a signed playback ticket (no expiry) for a specific video + user. */
export function createStreamTicket(videoId: string, userId: string): { ticket: string; expiresIn: number } {
  const ticket = jwt.sign({ videoId, userId }, EFFECTIVE_JWT_SECRET);
  return { ticket, expiresIn: 0 };
}

/**
 * Verify a playback ticket (signature only — no expiry). Returns the payload,
 * or null for an invalid signature or malformed payload.
 * Never throws — callers treat any failure as an invalid ticket.
 */
export function verifyStreamTicket(ticket: string): StreamTicketPayload | null {
  try {
    const payload = jwt.verify(ticket, EFFECTIVE_JWT_SECRET) as jwt.JwtPayload & StreamTicketPayload;
    if (typeof payload.videoId !== "string" || typeof payload.userId !== "string") return null;
    return { videoId: payload.videoId, userId: payload.userId };
  } catch {
    return null; // invalid signature
  }
}
