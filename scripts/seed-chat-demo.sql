-- Seed fake data so the /chat preview matches the reference photo.
-- Re-runnable: cleans up previous seed rows (by fixed IDs / ghost username) first.
-- All demo accounts use password: demo123

BEGIN;

-- ── Cleanup previous seed (FK cascades handle most child rows) ──
DELETE FROM users WHERE username ~ '^ghost_' OR username IN ('owner','demo','alya','rizky','salsa','dafa','nina','bimo');
DELETE FROM conversations WHERE id NOT IN (SELECT conversation_id FROM conversation_members);
DELETE FROM chat_rooms WHERE id IN ('11111110-0000-0000-0000-000000000001','11111110-0000-0000-0000-000000000002','11111110-0000-0000-0000-000000000003');

-- ── Fixed IDs ──
-- owner  : 11111110-1111-1111-1111-111111111111
-- demo   : 22222220-2222-2222-2222-222222222222  (the logged-in viewer)
-- alya   : a0a0a0a0-aaaa-aaaa-aaaa-aaaaaaaaaaaa
-- rizky  : b1b1b1b1-bbbb-bbbb-bbbb-bbbbbbbbbbbb
-- salsa  : c2c2c2c2-cccc-cccc-cccc-cccccccccccc
-- dafa   : d3d3d3d3-dddd-dddd-dddd-dddddddddddd
-- nina   : e4e4e4e4-eeee-eeee-eeee-eeeeeeeeeeee
-- bimo   : f5f5f5f5-ffff-ffff-ffff-ffffffffffff

-- ── Users (owner + viewer + 6 DM partners) ──
INSERT INTO users (id, username, password_hash, role, display_name, created_at, updated_at) VALUES
('11111110-1111-1111-1111-111111111111','owner','$2b$12$YYKy7wrnIL7jpa5EGV3fWO18gtl3M9TCne09QVLdvuuGYIwAfptiG','owner','Owner FUN+', now(), now()),
('22222220-2222-2222-2222-222222222222','demo','$2b$12$YYKy7wrnIL7jpa5EGV3fWO18gtl3M9TCne09QVLdvuuGYIwAfptiG','meril','Demo Viewer', now(), now()),
('a0a0a0a0-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Alya','$2b$12$YYKy7wrnIL7jpa5EGV3fWO18gtl3M9TCne09QVLdvuuGYIwAfptiG','meril','Alya', now(), now()),
('b1b1b1b1-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Rizky','$2b$12$YYKy7wrnIL7jpa5EGV3fWO18gtl3M9TCne09QVLdvuuGYIwAfptiG','meril','Rizky', now(), now()),
('c2c2c2c2-cccc-cccc-cccc-cccccccccccc','Salsa','$2b$12$YYKy7wrnIL7jpa5EGV3fWO18gtl3M9TCne09QVLdvuuGYIwAfptiG','meril','Salsa', now(), now()),
('d3d3d3d3-dddd-dddd-dddd-dddddddddddd','Dafa','$2b$12$YYKy7wrnIL7jpa5EGV3fWO18gtl3M9TCne09QVLdvuuGYIwAfptiG','meril','Dafa', now(), now()),
('e4e4e4e4-eeee-eeee-eeee-eeeeeeeeeeee','Nina','$2b$12$YYKy7wrnIL7jpa5EGV3fWO18gtl3M9TCne09QVLdvuuGYIwAfptiG','meril','Nina', now(), now()),
('f5f5f5f5-ffff-ffff-ffff-ffffffffffff','Bimo','$2b$12$YYKy7wrnIL7jpa5EGV3fWO18gtl3M9TCne09QVLdvuuGYIwAfptiG','meril','Bimo', now(), now());

-- ── Ghost users to pad realistic group member counts ──
INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
SELECT
  ('33333330-0000-0000-0000-' || lpad(gs::text, 12, '0'))::uuid,
  'ghost_' || gs,
  '$2b$12$YYKy7wrnIL7jpa5EGV3fWO18gtl3M9TCne09QVLdvuuGYIwAfptiG',
  'meril', now(), now()
FROM generate_series(1, 234) gs;

-- ── Announcement (owner-only chat thread) ──
INSERT INTO announcements (id, title, content, created_by, is_pinned, visibility, created_at, updated_at)
VALUES (
  '11111110-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Promo Spesial Bundle Hari Ini!',
  'Halo, FUN+ Family! 🥳 Ada promo spesial untuk semua bundle hari ini! Buruan checkout sebelum kehabisan ya~',
  '11111110-1111-1111-1111-111111111111',
  true, 'all',
  now() - interval '2 hour', now() - interval '2 hour'
);

-- A couple of owner chat messages in the announcement thread
INSERT INTO announcement_comments (announcement_id, user_id, content, created_at, updated_at) VALUES
('11111110-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111110-1111-1111-1111-111111111111','Selamat pagi semuanya! Jangan lupa cek promo hari ini ya 🎉', now() - interval '1 hour', now() - interval '1 hour'),
('11111110-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111110-1111-1111-1111-111111111111','Bundle belajar terbaru diskon 30% lho, cuma hari ini!', now() - interval '30 minute', now() - interval '30 minute');

-- ── Groups (chat_rooms) created by owner ──
INSERT INTO chat_rooms (id, name, slug, description, category, is_pinned_group, is_public, sort_order, created_by, created_at, updated_at) VALUES
('11111110-0000-0000-0000-000000000001','Belajar Bareng FUN+','belajar-bareng-fun','Tempat belajar bareng dan diskus materi','Belajar', true, true, 1, '11111110-1111-1111-1111-111111111111', now() - interval '7 day', now() - interval '7 day'),
('11111110-0000-0000-0000-000000000002','Teman Main Seru','teman-main-seru','Ajak teman main futsal dan olahraga','Olahraga', false, true, 2, '11111110-1111-1111-1111-111111111111', now() - interval '14 day', now() - interval '14 day'),
('11111110-0000-0000-0000-000000000003','Kreator Cilik','kreator-cilik','Share karya dan ide kreatif kamu di sini','Kreativitas', false, true, 3, '11111110-1111-1111-1111-111111111111', now() - interval '21 day', now() - interval '21 day');

-- ── Group members: real users + ghost padding to reach counts (128 / 64 / 42) ──
-- Real members first
INSERT INTO chat_room_members (room_id, user_id, role, joined_at) VALUES
('11111110-0000-0000-0000-000000000001','11111110-1111-1111-1111-111111111111','admin', now() - interval '7 day'),
('11111110-0000-0000-0000-000000000001','b1b1b1b1-bbbb-bbbb-bbbb-bbbbbbbbbbbb','member', now() - interval '6 day'),
('11111110-0000-0000-0000-000000000001','a0a0a0a0-aaaa-aaaa-aaaa-aaaaaaaaaaaa','member', now() - interval '6 day'),
('11111110-0000-0000-0000-000000000002','11111110-1111-1111-1111-111111111111','admin', now() - interval '14 day'),
('11111110-0000-0000-0000-000000000002','a0a0a0a0-aaaa-aaaa-aaaa-aaaaaaaaaaaa','member', now() - interval '13 day'),
('11111110-0000-0000-0000-000000000003','11111110-1111-1111-1111-111111111111','admin', now() - interval '21 day'),
('11111110-0000-0000-0000-000000000003','c2c2c2c2-cccc-cccc-cccc-cccccccccccc','member', now() - interval '20 day');

-- Ghost padding so totals reach 128 / 64 / 42 (incl. real members + demo added below)
-- g1: 3 real + 124 ghost + demo = 128 ; g2: 2 real + 61 ghost + demo = 64 ; g3: 2 real + 39 ghost + demo = 42
INSERT INTO chat_room_members (room_id, user_id, joined_at)
SELECT
  CASE
    WHEN rn <= 124 THEN '11111110-0000-0000-0000-000000000001'::uuid
    WHEN rn <= 185 THEN '11111110-0000-0000-0000-000000000002'::uuid
    WHEN rn <= 224 THEN '11111110-0000-0000-0000-000000000003'::uuid
  END,
  id, now()
FROM (
  SELECT id, row_number() OVER (ORDER BY username) AS rn
  FROM users WHERE username ~ '^ghost_'
) t
WHERE rn <= 224;

-- ── Group messages (demo read 1h ago → unread = msgs after that) ──
-- g1: 3 unread, latest from Rizky
INSERT INTO chat_messages (room_id, user_id, content, message_type, created_at) VALUES
('11111110-0000-0000-0000-000000000001','11111110-1111-1111-1111-111111111111','Selamat datang di grup belajar! 👋','text', now() - interval '3 hour'),
('11111110-0000-0000-0000-000000000001','a0a0a0a0-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Halo semuanya, salam kenal!','text', now() - interval '40 minute'),
('11111110-0000-0000-0000-000000000001','b1b1b1b1-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Aku udah siap kuis besok','text', now() - interval '20 minute'),
('11111110-0000-0000-0000-000000000001','b1b1b1b1-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Besok ada kuis ya, jangan lupa belajar!','text', now() - interval '5 minute');

-- g2: 2 unread, latest from Alya
INSERT INTO chat_messages (room_id, user_id, content, message_type, created_at) VALUES
('11111110-0000-0000-0000-000000000002','11111110-1111-1111-1111-111111111111','Yuk aktif lagi main bareng','text', now() - interval '3 hour'),
('11111110-0000-0000-0000-000000000002','c2c2c2c2-cccc-cccc-cccc-cccccccccccc','Boleh dong aku ikut','text', now() - interval '30 minute'),
('11111110-0000-0000-0000-000000000002','a0a0a0a0-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Siang nanti futsal yuk! ⚽','text', now() - interval '5 minute');

-- g3: 1 unread, latest from Salsa
INSERT INTO chat_messages (room_id, user_id, content, message_type, created_at) VALUES
('11111110-0000-0000-0000-000000000003','11111110-1111-1111-1111-111111111111','Share karya kreatif kalian ya','text', now() - interval '3 hour'),
('11111110-0000-0000-0000-000000000003','c2c2c2c2-cccc-cccc-cccc-cccccccccccc','Aku upload gambar baru nih!','text', now() - interval '5 minute');

-- demo is a member + has read up to 1 hour ago (so the recent msgs count as unread)
INSERT INTO chat_room_members (room_id, user_id, role, joined_at) VALUES
('11111110-0000-0000-0000-000000000001','22222220-2222-2222-2222-222222222222','member', now() - interval '2 day'),
('11111110-0000-0000-0000-000000000002','22222220-2222-2222-2222-222222222222','member', now() - interval '2 day'),
('11111110-0000-0000-0000-000000000003','22222220-2222-2222-2222-222222222222','member', now() - interval '2 day');

INSERT INTO chat_reads (room_id, user_id, last_read_at) VALUES
('11111110-0000-0000-0000-000000000001','22222220-2222-2222-2222-222222222222', now() - interval '1 hour'),
('11111110-0000-0000-0000-000000000002','22222220-2222-2222-2222-222222222222', now() - interval '1 hour'),
('11111110-0000-0000-0000-000000000003','22222220-2222-2222-2222-222222222222', now() - interval '1 hour');

-- ── DM conversations (demo <-> each partner), inserted in photo order ──
-- alya (unread 2)
INSERT INTO conversations (id, created_at, updated_at) VALUES ('11111110-b000-0000-0000-000000000001', now() - interval '2 hour', now() - interval '5 minute');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000001','22222220-2222-2222-2222-222222222222', now() - interval '2 hour');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000001','a0a0a0a0-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '2 hour');
INSERT INTO direct_messages (conversation_id, sender_id, content, message_type, created_at) VALUES
('11111110-b000-0000-0000-000000000001','a0a0a0a0-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Hai kak! Videomu yang terbaru keren banget','text', now() - interval '15 minute'),
('11111110-b000-0000-0000-000000000001','a0a0a0a0-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Hai! Kak, videonya seru banget yaa 😍','text', now() - interval '5 minute');

-- rizky (unread 1)
INSERT INTO conversations (id, created_at, updated_at) VALUES ('11111110-b000-0000-0000-000000000002', now() - interval '2 hour', now() - interval '10 minute');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000002','22222220-2222-2222-2222-222222222222', now() - interval '2 hour');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000002','b1b1b1b1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now() - interval '2 hour');
INSERT INTO direct_messages (conversation_id, sender_id, content, message_type, created_at) VALUES
('11111110-b000-0000-0000-000000000002','b1b1b1b1-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Iyaaa! Aku udah nonton semua hehe 😊','text', now() - interval '10 minute');

-- salsa (unread 1)
INSERT INTO conversations (id, created_at, updated_at) VALUES ('11111110-b000-0000-0000-000000000003', now() - interval '2 hour', now() - interval '20 minute');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000003','22222220-2222-2222-2222-222222222222', now() - interval '2 hour');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000003','c2c2c2c2-cccc-cccc-cccc-cccccccccccc', now() - interval '2 hour');
INSERT INTO direct_messages (conversation_id, sender_id, content, message_type, created_at) VALUES
('11111110-b000-0000-0000-000000000003','c2c2c2c2-cccc-cccc-cccc-cccccccccccc','Ada rekomendasi video belajar baru gak?','text', now() - interval '20 minute');

-- dafa (unread 0 — read by demo)
INSERT INTO conversations (id, created_at, updated_at) VALUES ('11111110-b000-0000-0000-000000000004', now() - interval '1 day', now() - interval '30 minute');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000004','22222220-2222-2222-2222-222222222222', now() - interval '1 day');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000004','d3d3d3d3-dddd-dddd-dddd-dddddddddddd', now() - interval '1 day');
INSERT INTO direct_messages (conversation_id, sender_id, content, message_type, created_at) VALUES
('11111110-b000-0000-0000-000000000004','d3d3d3d3-dddd-dddd-dddd-dddddddddddd','Thank you! Pembayarannya udah masuk ya 🙏','text', now() - interval '30 minute');
INSERT INTO dm_reads (conversation_id, user_id, last_read_at) VALUES ('11111110-b000-0000-0000-000000000004','22222220-2222-2222-2222-222222222222', now());

-- nina (unread 0 — read by demo)
INSERT INTO conversations (id, created_at, updated_at) VALUES ('11111110-b000-0000-0000-000000000005', now() - interval '1 day', now() - interval '40 minute');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000005','22222220-2222-2222-2222-222222222222', now() - interval '1 day');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000005','e4e4e4e4-eeee-eeee-eeee-eeeeeeeeeeee', now() - interval '1 day');
INSERT INTO direct_messages (conversation_id, sender_id, content, message_type, created_at) VALUES
('11111110-b000-0000-0000-000000000005','e4e4e4e4-eeee-eeee-eeee-eeeeeeeeeeee','Kak, boleh minta link videonya? 😊','text', now() - interval '40 minute');
INSERT INTO dm_reads (conversation_id, user_id, last_read_at) VALUES ('11111110-b000-0000-0000-000000000005','22222220-2222-2222-2222-222222222222', now());

-- bimo (unread 0 — read by demo)
INSERT INTO conversations (id, created_at, updated_at) VALUES ('11111110-b000-0000-0000-000000000006', now() - interval '1 day', now() - interval '50 minute');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000006','22222220-2222-2222-2222-222222222222', now() - interval '1 day');
INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ('11111110-b000-0000-0000-000000000006','f5f5f5f5-ffff-ffff-ffff-ffffffffffff', now() - interval '1 day');
INSERT INTO direct_messages (conversation_id, sender_id, content, message_type, created_at) VALUES
('11111110-b000-0000-0000-000000000006','f5f5f5f5-ffff-ffff-ffff-ffffffffffff','Siap! Tunggu sebentar ya 😊','text', now() - interval '50 minute');
INSERT INTO dm_reads (conversation_id, user_id, last_read_at) VALUES ('11111110-b000-0000-0000-000000000006','22222220-2222-2222-2222-222222222222', now());

COMMIT;
