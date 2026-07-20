---
name: Chat groups architecture
description: Multi-group chat system replacing the old single public chat + DM tabs
---

## Core changes
- DM feature **fully removed**: `directMessagesRouter` unregistered from `routes/index.ts`; `DMPage` import and `/chat/dm/:id` route removed from `App.tsx`; DM table definitions removed from `lib/db/src/schema/chat.ts` (tables still exist in DB, not dropped)
- `chat/index.tsx` rewritten: 2 tabs (Chats, Announcements); Chats tab = GroupsPane (search bar + 15-category filter pills + groups list); clicking a group navigates to `/chat/room/:id`
- `chat/room.tsx` rewritten: full-screen (no BottomNav), Telegram-style top nav with back button + group avatar + name + member count; DropCard integrated; typing indicator (polls `/chat/rooms/:id/typing` every 3s); messages poll every 2.5s

## New DB columns on chatRoomsTable
- `category text` — e.g. "General", "Gaming", "Anime" (matches ALL_CATEGORIES list in GroupsPane)
- `is_pinned_group boolean default false` — pinned groups appear first in list
- `is_public boolean default true` — public vs private
- `sort_order integer default 0` — manual sort; sorted asc after pinned
- `member_limit integer nullable` — optional max members

## API endpoints added
- `GET /chat/groups` — enhanced rooms list with `latestMessage` (batch-fetched), `unreadCount` (parallel per-room count query vs chatReadsTable), `category`, `isPinnedGroup`, `isPublic`, `sortOrder`; supports `?search=` (ilike) and `?category=` filters; sorted by isPinnedGroup DESC, sortOrder ASC, createdAt DESC
- `PATCH /chat/rooms/:id/group-settings` — owner-only; updates category/isPinnedGroup/isPublic/sortOrder/memberLimit

## Admin panel
- `/admin/chat-rooms` create/edit modal now includes: category dropdown, Pin toggle, Public toggle, Sort Order input, Max Members input
- Group cards show category badge, pin icon, private icon, member limit, sort order

## MessageBubble
- Added `authorVerificationBadge?: string | null` prop
- Renders `<VerificationBadge verificationBadge={...} size="xs" showTooltip={false} />` between username and RoleBadge

**Why:** Spec required Telegram/Discord-style multi-group chat replacing the old single global chat. DM tables kept in DB (drizzle push non-destructive) to avoid data loss.

**How to apply:** When adding new group features, the canonical data source is `/chat/groups`; the old `/chat/rooms` still works but does not include latestMessage/unreadCount.
