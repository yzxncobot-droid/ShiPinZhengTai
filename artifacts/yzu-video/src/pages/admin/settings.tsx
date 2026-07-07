import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Save, QrCode, Loader2, Upload, Globe, MessageCircle, Settings } from "lucide-react";

export default function AdminSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { token } = useAuth();
  const [form, setForm] = useState<Record<string, any>>({});
  const [qrisUploading, setQrisUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => adminFetch("/settings"),
  });

  useEffect(() => {
    if (settings) setForm(settings as any);
  }, [settings]);

  const updateMut = useMutation({
    mutationFn: (data: any) => adminFetch("/settings", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast({ title: "✅ Pengaturan disimpan" }); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const set = (key: string, val: any) => setForm(p => ({ ...p, [key]: val }));

  const handleImageUpload = async (file: File, field: string, setLoading: (v: boolean) => void) => {
    setLoading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload/image", {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload gagal");
      set(field, data.url);
      toast({ title: "Gambar berhasil diupload" });
    } catch (e: any) {
      toast({ title: "Upload gagal", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const Section = ({ icon: Icon, title, desc, children }: any) => (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        {desc && <CardDescription>{desc}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );

  const Field = ({ label, field, placeholder, type = "text" }: any) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} value={form[field] ?? ""} onChange={(e) => set(field, e.target.value)} placeholder={placeholder} />
    </div>
  );

  return (
    <ProtectedRoute allowedRoles={["owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-6 max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Pengaturan Website</h1>
              <p className="text-sm text-muted-foreground">Konfigurasi platform Yzu视频</p>
            </div>
            <Button onClick={() => updateMut.mutate(form)} disabled={updateMut.isPending} className="gap-2">
              {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Simpan Semua
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {Array(4).fill(0).map((_, i) => <div key={i} className="h-40 bg-card rounded-xl border animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-6">
              {/* General */}
              <Section icon={Globe} title="Informasi Website" desc="Nama, logo, dan metadata utama">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Nama Website" field="siteName" placeholder="Yzu视频" />
                  <Field label="Tagline" field="tagline" placeholder="Platform video premium" />
                </div>
                <div className="space-y-1.5">
                  <Label>Deskripsi</Label>
                  <Textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2} placeholder="Platform streaming video premium Indonesia" />
                </div>
                <div className="space-y-1.5">
                  <Label>Logo URL</Label>
                  <div className="flex gap-2">
                    <Input value={form.logo ?? ""} onChange={(e) => set("logo", e.target.value)} placeholder="https://..." className="flex-1" />
                    <Button variant="outline" size="sm" className="gap-1 shrink-0" asChild>
                      <label className="cursor-pointer">
                        <Upload className="h-3.5 w-3.5" />
                        <input type="file" accept="image/*" className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], "logo", setLogoUploading)} />
                        {logoUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Upload"}
                      </label>
                    </Button>
                  </div>
                  {form.logo && <img src={form.logo} className="h-10 object-contain mt-1" alt="Logo" />}
                </div>
              </Section>

              {/* QRIS */}
              <Section icon={QrCode} title="Konfigurasi QRIS" desc="Gambar QRIS untuk pembayaran top-up">
                <div className="space-y-1.5">
                  <Label>URL Gambar QRIS</Label>
                  <div className="flex gap-2">
                    <Input value={form.qrisImage ?? ""} onChange={(e) => set("qrisImage", e.target.value)} placeholder="https://..." className="flex-1" />
                    <Button variant="outline" size="sm" className="gap-1 shrink-0" asChild>
                      <label className="cursor-pointer">
                        <Upload className="h-3.5 w-3.5" />
                        <input type="file" accept="image/*" className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], "qrisImage", setQrisUploading)} />
                        {qrisUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Upload"}
                      </label>
                    </Button>
                  </div>
                </div>
                {form.qrisImage && (
                  <div className="bg-white p-4 rounded-xl inline-block border">
                    <img src={form.qrisImage} className="h-40 w-40 object-contain" alt="QRIS" />
                  </div>
                )}
              </Section>

              {/* Contact & Social */}
              <Section icon={MessageCircle} title="Kontak & Media Sosial" desc="Link dukungan dan akun media sosial">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="WhatsApp" field="whatsappLink" placeholder="https://wa.me/62..." />
                  <Field label="Telegram" field="telegramLink" placeholder="https://t.me/..." />
                  <Field label="Discord" field="discordLink" placeholder="https://discord.gg/..." />
                  <Field label="Instagram" field="instagramLink" placeholder="https://instagram.com/..." />
                  <Field label="Facebook" field="facebookLink" placeholder="https://facebook.com/..." />
                  <Field label="YouTube" field="youtubeLink" placeholder="https://youtube.com/..." />
                  <Field label="TikTok" field="tiktokLink" placeholder="https://tiktok.com/@..." />
                </div>
              </Section>

              {/* SEO */}
              <Section icon={Settings} title="SEO & Analytics" desc="Pengaturan mesin pencari dan tracking">
                <div className="space-y-4">
                  <Field label="Meta Title" field="metaTitle" placeholder="Yzu视频 - Platform Video Premium" />
                  <Field label="Google Analytics ID" field="googleAnalyticsId" placeholder="G-XXXXXXXXXX" />
                  <Field label="Google Search Console" field="googleSearchConsoleId" placeholder="verification code" />
                </div>
              </Section>

              <div className="flex justify-end">
                <Button onClick={() => updateMut.mutate(form)} disabled={updateMut.isPending} size="lg" className="gap-2">
                  {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Simpan Pengaturan
                </Button>
              </div>
            </div>
          )}
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
