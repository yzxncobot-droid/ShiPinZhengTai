/**
 * @deprecated Use publicStorage (public.ts) directly.
 *
 * This file is kept only for backward-compat imports.
 * All Creator uploads now go to the PUBLIC Supabase project via public.ts.
 */

export {
  creatorPublicStorage as creatorStorage,
  isPublicStorageAvailable as isCreatorStorageAvailable,
} from "./public";
