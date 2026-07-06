---
name: Yzu视频 API response shapes
description: Which generated hooks return direct arrays vs paginated { data, total, page, limit } objects
---

## Direct arrays (use as-is, no .data)
- `useListCategories` → `Category[]`
- `useGetFeaturedVideos` → `Video[]`
- `useGetTrendingVideos` → `Video[]`
- `useGetRelatedVideos` → `Video[]`
- `useListSubscriptions` → `Subscription[]`
- `useListNotifications` → `Notification[]`

## Paginated objects (use `.data` for the array)
- `useListVideos` → `VideoList { data, total, page, limit }`
- `useListUsers` → `UserList { data, total, page, limit }`
- `useGetWatchHistory` → `VideoList { data, total, page, limit }`
- `useGetTopupHistory` → paginated `{ data, total, page, limit }`
- `useGetTransactionHistory` → paginated `{ data, total, page, limit }`
- `useFetchVideoComments` → `CommentList { data, total, page, limit }`

**Why:** The OpenAPI spec uses `*List` schemas for paginated endpoints and plain arrays for simple list endpoints. The codegen preserves this distinction. Getting it wrong causes `Cannot read properties of undefined (reading 'map')` runtime errors.
