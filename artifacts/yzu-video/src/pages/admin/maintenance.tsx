/**
 * Owner Maintenance Settings Page
 * /admin/maintenance
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { adminFetch } from "@/lib/admin-api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Wrench, Power, PowerOff, Clock, Image, ExternalLink, Type,
  AlignLeft, Loader2, Save, Eye, ToggleLeft, ToggleRight, AlertTriangle,
  CheckCircle2, Upload,
} from "lucide-react";

interface MaintenanceSettings {
  maintenanceEnabled: boolean;
  maintenanceTitle?: string | null;
  maintenanceDescription?: string | null;
  maintenanceImage?: string | null;
  maintenanceButtonText?: string | null;
  maintenanceRedirectUrl?: string | null;
  maintenanceEta?: string | null;
  maintenanceCountdown?: boolean;
}

export default function AdminMaintenancePage() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState<MaintenanceSettings>({
    maintenanceEnabled: false,
    maintenanceTitle: "",
    maintenanceDescription: "",
    maintenanceImage: "",
    maintenanceButtonText: "",
    maintenanceRedirectUrl: "",
    maintenanceEta: "",
    maintenanceCountdown: false,
  });
  const [imageUploading, setImageUploading] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["maintenance-status"],
    queryFn: () => adminFetch<MaintenanceSettings>("/settings/maintenance-status"),
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (status) {
      setForm({
        maintenanceEnabled: status.maintenanceEnabled ?? false,
        maintenanceTitle: status.maintenanceTitle ?? "",
        maintenanceDescription: status.maintenanceDescription ?? "",
        maintenanceImage: status.maintenanceImage ?? "",
        maintenanceButtonText: status.maintenanceButtonText ?? "",
        maintenanceRedirectUrl: status.maintenanceRedirectUrl ?? "",
        maintenanceEta: status.maintenanceEta
          ? new Date(status.maintenanceEta).toISOString().slice(0, 16)
          : "",
        maintenanceCountdown: status.maintenanceCountdown ?? false,
      });
    }
  }, [status]);

  const saveMut = useMutation({
    mutationFn: (data: Partial<MaintenanceSettings>) =>
      adminFetch("/settings/maintenance", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance-status"] });
      toast({ title: "✅ Pengaturan maintenance disimpan" });
    },
    onError: (e: any) => toast({ title: "Gagal menyimpan", description: e.message, variant: "destructive" }),
  });

  const set = (key: keyof MaintenanceSettings, val: any) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const handleToggle = async () => {
    setToggleLoading(true);
    try {
      await adminFetch("/settings/maintenance", {
        method: "PATCH",
        body: JSON.stringify({ maintenanceEnabled: !form.maintenanceEnabled }),
      });
      const newState = !form.maintenanceEnabled;
      setForm(prev => ({ ...prev, maintenanceEnabled: newState }));
      qc.invalidateQueries({ queryKey: ["maintenance-status"] });
      toast({
        title: newState ? "🔴 Maintenance Mode AKTIF" : "✅ Maintenance Mode NONAKTIF",
        description: newState
          ? "Semua pengguna kecuali Owner akan diarahkan ke halaman maintenance."
          : "Situs kembali dapat diakses oleh semua pengguna.",
      });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setToggleLoading(false);
    }
  };

  const handleSave = () => {
    saveMut.mutate({
      ...form,
      maintenanceEta: form.maintenanceEta ? new Date(form.maintenanceEta).toISOString() : null,
    });
  };

  const handleImageUpload = async (file: File) => {
    setImageUploading(true);
    const fd = new FormData();
    fd.append("image", file);
    fd.append("assetType", "banner");
    try {
      const res = await fetch("/api/upload/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.message || "Upload gagal");
      set("maintenanceImage", data.url);
      toast({ title: "✅ Gambar diupload" });
    } catch (e: any) {
      toast({ title: "Upload gagal", description: e.message, variant: "destructive" });
    } finally {
      setImageUploading(false);
    }
  };

  if (user?.role !== "owner") {
    return (
      <ProtectedRoute role="owner">
        <AdminLayout>
          <div className="flex items-center justify-center h-40">
            <p className="text-slate-400">Hanya Owner yang dapat mengakses halaman ini.</p>
          </div>
        </AdminLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute role="owner">
      <AdminLayout>
        <div className="max-w-2xl mx-auto space-y-6 pb-10">

          {/* Header */}
          <div>
            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <Wrench className="h-6 w-6 text-purple-500" />
              Maintenance Mode
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Kendalikan akses situs. Hanya Owner yang bisa tetap menggunakannya saat maintenance aktif.
            </p>
          </div>

          {/* Master toggle */}
          <Card className={`border-2 transition-all ${form.maintenanceEnabled ? "border-red-300 bg-red-50" : "border-green-200 bg-green-50"}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {form.maintenanceEnabled ? (
                    <div className="h-10 w-10 rounded-xl bg-red-100 flex items-center justify-center">
                      <PowerOff className="h-5 w-5 text-red-600" />
                    </div>
                  ) : (
                    <div className="h-10 w-10 rounded-xl bg-green-100 flex items-center justify-center">
                      <Power className="h-5 w-5 text-green-600" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-extrabold text-slate-800">
                        {form.maintenanceEnabled ? "Maintenance AKTIF" : "Situs Normal"}
                      </p>
                      <Badge variant={form.maintenanceEnabled ? "destructive" : "default"}
                        className={form.maintenanceEnabled ? "" : "bg-green-600"}>
                        {form.maintenanceEnabled ? "AKTIF" : "ONLINE"}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {form.maintenanceEnabled
                        ? "Pengguna non-Owner diarahkan ke halaman maintenance"
                        : "Semua pengguna dapat mengakses situs normal"}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleToggle}
                  disabled={toggleLoading}
                  size="sm"
                  className={`font-bold min-w-[120px] ${form.maintenanceEnabled
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "bg-red-500 hover:bg-red-600 text-white"
                  }`}
                >
                  {toggleLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : form.maintenanceEnabled ? (
                    <><ToggleRight className="h-4 w-4 mr-1.5" /> Nonaktifkan</>
                  ) : (
                    <><ToggleLeft className="h-4 w-4 mr-1.5" /> Aktifkan</>
                  )}
                </Button>
              </div>

              {form.maintenanceEnabled && (
                <div className="mt-3 flex items-center gap-2 bg-red-100 rounded-xl px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                  <p className="text-xs font-medium text-red-700">
                    Maintenance mode aktif. API mengembalikan 503 untuk semua pengguna non-Owner.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Content settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Type className="h-4 w-4 text-purple-500" /> Konten Halaman Maintenance
              </CardTitle>
              <CardDescription>Teks dan gambar yang ditampilkan ke pengguna</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-slate-500">Judul</Label>
                <Input
                  value={form.maintenanceTitle ?? ""}
                  onChange={e => set("maintenanceTitle", e.target.value)}
                  placeholder="Sedang Dalam Pemeliharaan"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-500">Deskripsi</Label>
                <Textarea
                  value={form.maintenanceDescription ?? ""}
                  onChange={e => set("maintenanceDescription", e.target.value)}
                  placeholder="Kami sedang melakukan peningkatan sistem. Mohon tunggu sebentar."
                  className="mt-1 resize-none"
                  rows={3}
                />
              </div>

              {/* Image upload */}
              <div>
                <Label className="text-xs text-slate-500">Gambar Ilustrasi</Label>
                <div className="mt-1 flex gap-3 items-start">
                  <div className="flex-1">
                    <Input
                      value={form.maintenanceImage ?? ""}
                      onChange={e => set("maintenanceImage", e.target.value)}
                      placeholder="https://... atau upload gambar"
                    />
                  </div>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                    />
                    <Button type="button" variant="outline" size="sm" disabled={imageUploading} className="shrink-0">
                      {imageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    </Button>
                  </label>
                </div>
                {form.maintenanceImage && (
                  <div className="mt-2 rounded-xl overflow-hidden border border-slate-100 h-24 w-24">
                    <img src={form.maintenanceImage} alt="preview" className="w-full h-full object-contain bg-slate-50" />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Time settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-purple-500" /> Estimasi Waktu
              </CardTitle>
              <CardDescription>Perkiraan kapan maintenance selesai (opsional)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-slate-500">Estimasi Selesai</Label>
                <Input
                  type="datetime-local"
                  value={form.maintenanceEta ?? ""}
                  onChange={e => set("maintenanceEta", e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <p className="text-sm font-bold text-slate-700">Tampilkan Countdown Timer</p>
                  <p className="text-xs text-slate-400">Hitung mundur menuju waktu estimasi</p>
                </div>
                <button
                  onClick={() => set("maintenanceCountdown", !form.maintenanceCountdown)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
                    ${form.maintenanceCountdown ? "bg-purple-500" : "bg-slate-300"}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform
                      ${form.maintenanceCountdown ? "translate-x-6" : "translate-x-1"}`}
                  />
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Button / Redirect */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ExternalLink className="h-4 w-4 text-purple-500" /> Tombol & Redirect
              </CardTitle>
              <CardDescription>
                Tombol akan muncul jika Redirect URL diisi. Biarkan kosong untuk menyembunyikan tombol.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-slate-500">Teks Tombol</Label>
                <Input
                  value={form.maintenanceButtonText ?? ""}
                  onChange={e => set("maintenanceButtonText", e.target.value)}
                  placeholder="Bergabung di Discord"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-500">Redirect URL</Label>
                <Input
                  value={form.maintenanceRedirectUrl ?? ""}
                  onChange={e => set("maintenanceRedirectUrl", e.target.value)}
                  placeholder="https://discord.gg/example"
                  type="url"
                  className="mt-1"
                />
              </div>

              {form.maintenanceButtonText && form.maintenanceRedirectUrl && (
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-purple-500 shrink-0" />
                  <p className="text-xs text-purple-700 font-medium">
                    Tombol "<strong>{form.maintenanceButtonText}</strong>" akan tampil mengarah ke{" "}
                    <a href={form.maintenanceRedirectUrl} target="_blank" rel="noopener noreferrer"
                      className="underline truncate max-w-[200px] inline-block align-bottom">
                      {form.maintenanceRedirectUrl}
                    </a>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Save + Preview */}
          <div className="flex gap-3">
            <Button
              onClick={handleSave}
              disabled={saveMut.isPending}
              className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold"
            >
              {saveMut.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Menyimpan...</>
              ) : (
                <><Save className="h-4 w-4 mr-2" /> Simpan Pengaturan</>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open("/maintenance", "_blank")}
              className="flex items-center gap-2"
            >
              <Eye className="h-4 w-4" /> Preview
            </Button>
          </div>

          <p className="text-xs text-slate-400 text-center">
            Perubahan berlaku segera tanpa perlu restart. Cache dibersihkan otomatis saat menyimpan.
          </p>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
