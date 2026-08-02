/**
 * @deprecated Use publicStorage (public.ts) directly.
 *
 * This file is kept only for backward-compat imports.
 * All Verified Creator uploads now go to the PUBLIC Supabase project via public.ts.
 */

export {
  verifiedCreatorPublicStorage as verifiedCreatorStorage,
  isPublicStorageAvailable as isVerifiedCreatorStorageAvailable,
  uploadPublicPaymentProof as uploadPaymentProof,
} from "./public";
