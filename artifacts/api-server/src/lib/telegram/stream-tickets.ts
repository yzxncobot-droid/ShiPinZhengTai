/**
 * Short-lived stream playback tickets.
 *
 * A native HTML5 <video src=""> request cannot attach the Authorization
 * header that the API's Bearer-token auth requires, so the stream endpoint
 * also accepts a ?ticket= query parameter. The ticket is a JWT signed with
 * the SAME secret as the login tokens (JWT_SECRET / SESSION_SECRET) but with
 * a 2-hour expiry — long enough for the browser to continue issuing Range
 * requests throughout playback. Access is re-verified on every stream
 * request, so a longer TTL does not weaken premium/banned-user checks.
 *
 * The ticket payload contains ONLY: videoId, userId (+ exp/iat added by jwt).
 * It never contains the Telegram bot token, a Telegram file_id, or any other
 * credential.
 */
import jwt from "jsonwebtoken";
import { EFFECTIVE_JWT_SECRET } from "../../middlewares/auth";

/** Maximum ticket lifetime — 2 hours.
 *
 * The native <video> element issues Range requests throughout playback (not
 * just at the start) to buffer more data. A 60-second expiry caused every
 * Range request after the first minute to fail with "Invalid or expired
 * stream ticket", breaking any video longer than 60 seconds of real-time
 * playback. Two hours covers virtually all videos, and access is still
 * re-verified on every stream request via checkTelegramVideoAccess. */
export const STREAM_TICKET_TTL_SECONDS = 7200;

export interface StreamTicketPayload {
  videoId: string;
  userId: string;
}

/** Issue a signed, short-lived playback ticket for a specific video + user. */
export function createStreamTicket(videoId: string, userId: string): { ticket: string; expiresIn: number } {
  const ticket = jwt.sign({ videoId, userId }, EFFECTIVE_JWT_SECRET, {
    expiresIn: STREAM_TICKET_TTL_SECONDS,
  });
  return { ticket, expiresIn: STREAM_TICKET_TTL_SECONDS };
}

/**
 * Verify a playback ticket (signature + expiry). Returns the payload, or null
 * for an invalid signature, an expired ticket, or a malformed payload.
 * Never throws — callers treat any failure as an invalid ticket.
 */
export function verifyStreamTicket(ticket: string): StreamTicketPayload | null {
  try {
    const payload = jwt.verify(ticket, EFFECTIVE_JWT_SECRET) as jwt.JwtPayload & StreamTicketPayload;
    if (typeof payload.videoId !== "string" || typeof payload.userId !== "string") return null;
    return { videoId: payload.videoId, userId: payload.userId };
  } catch {
    return null; // invalid signature or expired
  }
}
