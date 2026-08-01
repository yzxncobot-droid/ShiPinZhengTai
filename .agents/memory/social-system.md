---
name: Social system architecture
description: Follow/DM/notifications system added in the social feature build
---

# Social System Architecture

## New DB tables
- `followers` — followerId + followingId unique pair
- `blocked_users` — blockerId + blockedId unique pair  
- `user_presence` — userId PK, status, lastSeenAt
- `conversations` / `conversation_members` / `direct_messages` / `dm_reactions` / `dm_reads` — P2P DM system

## Enhanced notifications
`notifications` table gained: `category` (social/activity/system/announcement/payment), `actorId`, `actorUsername`, `actorAvatar`, `referenceType`, `referenceId`, `actionUrl`.

## New API routes (all under /api)
- `POST/DELETE /social/follow/:userId` — follow/unfollow; creates a "social" notification
- `GET /social/stats/:userId` — follower/following counts + isFollowing
- `GET /social/followers/:userId`, `GET /social/following/:userId`
- `POST/DELETE /social/block/:userId`
- `GET /users/profile/:username` — public profile with social stats
- `POST/DELETE /social/presence` — heartbeat
- `/dm/*` routes — conversations, messages, read receipts (registered from direct-messages.ts)
- `GET /notifications?category=X` — filtered; `GET /notifications/unread-count`

## Frontend routes
- `/user/:username` — public profile with follow/unfollow/DM/block
- `/chat/dm/:id` — DM room (Telegram-style, polling 2s)
- Chat page has 3 tabs: Grup / DM / Pengumuman

## Known gaps (not yet wired)
- Profile page `/profile` still shows hardcoded 0 for follower stats — needs `/social/stats/me` call
- Notifications are NOT auto-created on bundle purchase / payment approval / video upload — those are separate backend integrations
- DM real-time uses polling (2s); WebSocket not implemented
