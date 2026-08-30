/**
 * Admin Gamification Management — manage achievements, special badges,
 * level config/tiers, level rewards, and manual EXP adjustments.
 */

import { ProtectedRoute } from "@/lib/protected-route";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Trophy, Star, Settings, Zap, Plus, Trash2, Edit3, X,
  Users, ChevronLeft, Save, AlertTriangle,
} from "lucide-react";
import { Link } from "wouter";

// ─── API helpers ───────────────────────────────────────────────────────────────

import { TOKEN_KEY } from "@/lib/auth";
function getToken() { return localStorage.getItem(TOKEN_KEY); }

async function adminFetch(path: string, options?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

type Tab = "achievements" | "badges" | "levels" | "exp";

export default function AdminGamificationPage() {
  const [tab, setTab] = useState<Tab>("achievements");

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="max-w-2xl mx-auto px-4 py-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <Link href="/admin" className="text-slate-400 hover:text-purple-600">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-lg font-heading font-extrabold text-slate-800">Gamification Management</h1>
          </div>

          {/* Tabs */}
          <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
            {([
              { id: "achievements" as Tab, label: "Achievement", icon: Trophy },
              { id: "badges" as Tab, label: "Badge", icon: Star },
              { id: "levels" as Tab, label: "Level Config", icon: Settings },
              { id: "exp" as Tab, label: "EXP Adjust", icon: Zap },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                  tab === t.id
                    ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow-md"
                    : "bg-white text-slate-600 border border-slate-100"
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {tab === "achievements" && <AchievementsTab />}
          {tab === "badges" && <BadgesTab />}
          {tab === "levels" && <LevelsTab />}
          {tab === "exp" && <ExpTab />}
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

// ─── Achievements Tab ─────────────────────────────────────────────────────────

function AchievementsTab() {
  const { toast } = useToast();
  const [achievements, setAchievements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await adminFetch("/admin/gamification/achievements");
      setAchievements(data);
    } catch { setAchievements([]); }
    setLoading(false);
  }

  useState(() => { load(); });

  async function save(ach: any) {
    try {
      if (ach.id) {
        await adminFetch(`/admin/gamification/achievements/${ach.id}`, {
          method: "PUT", body: JSON.stringify(ach),
        });
        toast({ title: "Achievement diperbarui!" });
      } else {
        await adminFetch("/admin/gamification/achievements", {
          method: "POST", body: JSON.stringify(ach),
        });
        toast({ title: "Achievement dibuat!" });
      }
      setEditing(null);
      setShowForm(false);
      load();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    }
  }

  async function deactivate(id: string) {
    if (!confirm("Nonaktifkan achievement ini?")) return;
    await adminFetch(`/admin/gamification/achievements/${id}`, { method: "DELETE" });
    toast({ title: "Achievement dinonaktifkan" });
    load();
  }

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Memuat...</div>;

  return (
    <div className="space-y-3">
      <button
        onClick={() => { setEditing({ name: "", description: "", icon: "🏆", rarity: "COMMON", requirementType: "watch_count", requirementValue: 1, expReward: 10, isHidden: false, isActive: true }); setShowForm(true); }}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md"
      >
        <Plus className="h-4 w-4" /> Buat Achievement
      </button>

      {showForm && editing && (
        <AchievementForm
          achievement={editing}
          onSave={save}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}

      {achievements.map((a) => (
        <div key={a.id} className={`bg-white rounded-2xl p-3 shadow-sm border border-slate-100 flex items-center gap-3 ${!a.isActive ? "opacity-50" : ""}`}>
          <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl shrink-0">{a.icon}</div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800 text-sm truncate">{a.name}</p>
            <p className="text-[11px] text-slate-500 truncate">{a.description}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{a.rarity}</span>
              <span className="text-[10px] font-bold text-purple-500">+{a.expReward} EXP</span>
              {a.isHidden && <span className="text-[9px] text-slate-400">Hidden</span>}
            </div>
          </div>
          <button onClick={() => { setEditing(a); setShowForm(true); }} className="text-slate-400 hover:text-purple-600">
            <Edit3 className="h-4 w-4" />
          </button>
          <button onClick={() => deactivate(a.id)} className="text-slate-400 hover:text-red-500">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function AchievementForm({ achievement, onSave, onCancel }: { achievement: any; onSave: (a: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState(achievement);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl p-4 shadow-lg border border-purple-100 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-800 text-sm">{achievement.id ? "Edit" : "Buat"} Achievement</h3>
        <button onClick={onCancel}><X className="h-4 w-4 text-slate-400" /></button>
      </div>
      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nama" className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
      <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Deskripsi" className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <input value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} placeholder="Icon (emoji)" className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
        <select value={form.rarity} onChange={e => setForm({ ...form, rarity: e.target.value })} className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm">
          <option value="COMMON">Common</option>
          <option value="RARE">Rare</option>
          <option value="EPIC">Epic</option>
          <option value="LEGENDARY">Legendary</option>
          <option value="SPECIAL">Special</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={form.requirementType} onChange={e => setForm({ ...form, requirementType: e.target.value })} className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm">
          <option value="first_watch">First Watch</option>
          <option value="first_like">First Like</option>
          <option value="watch_count">Watch Count</option>
          <option value="like_count">Like Count</option>
          <option value="comment_count">Comment Count</option>
          <option value="message_count">Message Count</option>
          <option value="group_count">Group Count</option>
          <option value="upload_count">Upload Count</option>
          <option value="streak">Streak Days</option>
          <option value="level">Level</option>
        </select>
        <input type="number" value={form.requirementValue} onChange={e => setForm({ ...form, requirementValue: parseInt(e.target.value) || 1 })} placeholder="Target" className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
      </div>
      <input type="number" value={form.expReward} onChange={e => setForm({ ...form, expReward: parseInt(e.target.value) || 0 })} placeholder="EXP Reward" className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={form.isHidden} onChange={e => setForm({ ...form, isHidden: e.target.checked })} />
          Hidden
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
      </div>
      <button onClick={() => onSave(form)} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white text-sm font-bold flex items-center justify-center gap-2">
        <Save className="h-4 w-4" /> Simpan
      </button>
    </motion.div>
  );
}

// ─── Badges Tab ───────────────────────────────────────────────────────────────

function BadgesTab() {
  const { toast } = useToast();
  const [badges, setBadges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", icon: "⭐", color: "#8b5cf6", description: "" });
  const [assignBadgeId, setAssignBadgeId] = useState<string | null>(null);
  const [assignUserId, setAssignUserId] = useState("");
  const [badgeUsers, setBadgeUsers] = useState<any[]>([]);

  async function load() {
    setLoading(true);
    try { setBadges(await adminFetch("/admin/gamification/badges")); } catch { setBadges([]); }
    setLoading(false);
  }
  useState(() => { load(); });

  async function createBadge() {
    try {
      await adminFetch("/admin/gamification/badges", { method: "POST", body: JSON.stringify(form) });
      toast({ title: "Badge dibuat!" });
      setForm({ name: "", icon: "⭐", color: "#8b5cf6", description: "" });
      setShowForm(false);
      load();
    } catch (e: any) { toast({ title: "Gagal", description: e.message, variant: "destructive" }); }
  }

  async function assignBadge() {
    if (!assignBadgeId || !assignUserId) return;
    try {
      await adminFetch(`/admin/gamification/badges/${assignBadgeId}/assign`, {
        method: "POST", body: JSON.stringify({ userId: assignUserId }),
      });
      toast({ title: "Badge diberikan!" });
      setAssignUserId("");
      loadBadgeUsers(assignBadgeId);
    } catch (e: any) { toast({ title: "Gagal", description: e.message, variant: "destructive" }); }
  }

  async function loadBadgeUsers(badgeId: string) {
    try { setBadgeUsers(await adminFetch(`/admin/gamification/badges/${badgeId}/users`)); }
    catch { setBadgeUsers([]); }
  }

  async function revokeBadge(badgeId: string, userId: string) {
    await adminFetch(`/admin/gamification/badges/${badgeId}/users/${userId}`, { method: "DELETE" });
    toast({ title: "Badge dicabut" });
    loadBadgeUsers(badgeId);
  }

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Memuat...</div>;

  return (
    <div className="space-y-3">
      <button
        onClick={() => setShowForm(!showForm)}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md"
      >
        <Plus className="h-4 w-4" /> Buat Badge
      </button>

      {showForm && (
        <div className="bg-white rounded-2xl p-4 shadow-lg border border-purple-100 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800 text-sm">Badge Baru</h3>
            <button onClick={() => setShowForm(false)}><X className="h-4 w-4 text-slate-400" /></button>
          </div>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nama (slug, mis: top_creator)" className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} placeholder="Icon (emoji)" className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
            <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm h-10" />
          </div>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Deskripsi" className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
          <button onClick={createBadge} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white text-sm font-bold">Simpan</button>
        </div>
      )}

      {badges.map((b) => (
        <div key={b.id} className="bg-white rounded-2xl p-3 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ backgroundColor: `${b.color}20` }}>
              {b.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-800 text-sm">{b.name}</p>
              <p className="text-[11px] text-slate-500 truncate">{b.description}</p>
            </div>
            <button onClick={() => { setAssignBadgeId(assignBadgeId === b.id ? null : b.id); if (assignBadgeId !== b.id) loadBadgeUsers(b.id); }} className="text-xs font-bold text-purple-500">
              {assignBadgeId === b.id ? "Tutup" : "Kelola"}
            </button>
          </div>

          {assignBadgeId === b.id && (
            <div className="mt-3 pt-3 border-t border-slate-50 space-y-2">
              <div className="flex gap-2">
                <input value={assignUserId} onChange={e => setAssignUserId(e.target.value)} placeholder="User ID" className="flex-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
                <button onClick={assignBadge} className="px-3 py-2 rounded-xl bg-purple-600 text-white text-xs font-bold">Beri</button>
              </div>
              {badgeUsers.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Pengguna dengan badge ini:</p>
                  {badgeUsers.map((u: any) => (
                    <div key={u.userId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50">
                      <span className="text-xs font-semibold text-slate-700 flex-1 truncate">{u.username}</span>
                      <button onClick={() => revokeBadge(b.id, u.userId)} className="text-[10px] font-bold text-red-500">Cabut</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Levels Tab ───────────────────────────────────────────────────────────────

function LevelsTab() {
  const { toast } = useToast();
  const [config, setConfig] = useState<any>({ baseExp: 100, stepExp: 50, growthMultiplier: 1.0, multiplierInterval: 5, maxLevel: 0 });
  const [tiers, setTiers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await adminFetch("/admin/gamification/config");
      setConfig(data.config);
      setTiers(data.tiers);
    } catch {}
    setLoading(false);
  }
  useState(() => { load(); });

  async function saveConfig() {
    try {
      await adminFetch("/admin/gamification/config", { method: "PUT", body: JSON.stringify(config) });
      toast({ title: "Config disimpan!" });
    } catch (e: any) { toast({ title: "Gagal", description: e.message, variant: "destructive" }); }
  }

  async function addTier() {
    try {
      await adminFetch("/admin/gamification/tiers", {
        method: "POST",
        body: JSON.stringify({ name: "New Tier", icon: "🏅", color: "#8b5cf6", minLevel: 60, sortOrder: tiers.length }),
      });
      toast({ title: "Tier dibuat!" });
      load();
    } catch (e: any) { toast({ title: "Gagal", description: e.message, variant: "destructive" }); }
  }

  async function deleteTier(id: string) {
    await adminFetch(`/admin/gamification/tiers/${id}`, { method: "DELETE" });
    toast({ title: "Tier dihapus" });
    load();
  }

  if (loading) return <div className="text-center py-8 text-slate-400 text-sm">Memuat...</div>;

  return (
    <div className="space-y-4">
      {/* Config */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
        <h3 className="font-bold text-slate-800 text-sm">Level Formula Config</h3>
        <p className="text-[11px] text-slate-500">EXP untuk level L = baseExp + (L-1) × stepExp × multiplier</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-slate-600">
            Base EXP
            <input type="number" value={config.baseExp} onChange={e => setConfig({ ...config, baseExp: parseInt(e.target.value) || 100 })} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Step EXP
            <input type="number" value={config.stepExp} onChange={e => setConfig({ ...config, stepExp: parseInt(e.target.value) || 50 })} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Growth Multiplier
            <input type="number" step="0.1" value={config.growthMultiplier} onChange={e => setConfig({ ...config, growthMultiplier: parseFloat(e.target.value) || 1.0 })} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Max Level (0=∞)
            <input type="number" value={config.maxLevel} onChange={e => setConfig({ ...config, maxLevel: parseInt(e.target.value) || 0 })} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
          </label>
        </div>
        <button onClick={saveConfig} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white text-sm font-bold flex items-center justify-center gap-2">
          <Save className="h-4 w-4" /> Simpan Config
        </button>
      </div>

      {/* Badge tiers */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800 text-sm">Level Badge Tiers</h3>
          <button onClick={addTier} className="text-xs font-bold text-purple-500 flex items-center gap-1">
            <Plus className="h-3 w-3" /> Tambah
          </button>
        </div>
        <div className="space-y-2">
          {tiers.map((t) => (
            <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50">
              <span className="text-lg">{t.icon}</span>
              <span className="text-sm font-bold text-slate-700 flex-1">{t.name}</span>
              <span className="text-xs text-slate-400">Lv.{t.minLevel}+</span>
              <button onClick={() => deleteTier(t.id)} className="text-slate-400 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── EXP Tab ──────────────────────────────────────────────────────────────────

function ExpTab() {
  const { toast } = useToast();
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadLogs() {
    setLoading(true);
    try { setLogs(await adminFetch("/admin/gamification/audit-logs?limit=50")); } catch { setLogs([]); }
    setLoading(false);
  }
  useState(() => { loadLogs(); });

  async function adjustExp() {
    if (!userId || !amount || !reason) {
      toast({ title: "Semua field wajib diisi", variant: "destructive" });
      return;
    }
    try {
      await adminFetch("/admin/gamification/adjust-exp", {
        method: "POST",
        body: JSON.stringify({ userId, amount: parseInt(amount), reason }),
      });
      toast({ title: "EXP disesuaikan!" });
      setUserId(""); setAmount(""); setReason("");
      loadLogs();
    } catch (e: any) { toast({ title: "Gagal", description: e.message, variant: "destructive" }); }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h3 className="font-bold text-slate-800 text-sm">Manual EXP Adjustment</h3>
        </div>
        <p className="text-[11px] text-slate-500">Setiap adjustment tercatat di audit log dengan admin ID, user ID, amount, dan reason.</p>
        <input value={userId} onChange={e => setUserId(e.target.value)} placeholder="User ID" className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Jumlah EXP (+/-)" className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Alasan (wajib)" className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
        <button onClick={adjustExp} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white text-sm font-bold">
          Sesuaikan EXP
        </button>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-800 text-sm mb-3">Audit Log</h3>
        {loading ? (
          <p className="text-center text-slate-400 text-sm py-4">Memuat...</p>
        ) : logs.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">Belum ada adjustment</p>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50">
                <Zap className={`h-3.5 w-3.5 ${log.amount > 0 ? "text-green-500" : "text-red-500"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-700">
                    {log.amount > 0 ? "+" : ""}{log.amount} EXP → {log.adminUsername}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">{log.reason}</p>
                </div>
                <span className="text-[9px] text-slate-300 shrink-0">
                  {new Date(log.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
