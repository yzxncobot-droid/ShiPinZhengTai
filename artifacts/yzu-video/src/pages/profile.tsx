import { ProtectedRoute } from "@/lib/protected-route";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUpdateUser, useGetMe } from "@workspace/api-client-react";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Camera, Wallet, Crown } from "lucide-react";

export default function ProfilePage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  // Fetch fresh user data to ensure we have latest balance/subscription
  const { data: freshUser, refetch } = useGetMe();
  const updateUser = useUpdateUser();
  
  const currentUser = freshUser || user;

  const [username, setUsername] = useState(currentUser?.username || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("image", file);

    try {
      const res = await fetch("/api/upload/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      
      updateUser.mutate({ id: currentUser.id, data: { avatar: data.url } }, {
        onSuccess: () => {
          toast({ title: "Avatar updated" });
          refetch();
        }
      });
    } catch (err: any) {
      toast({ title: "Failed to upload avatar", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    const data: any = { username };
    if (currentPassword && newPassword) {
      data.currentPassword = currentPassword;
      data.newPassword = newPassword;
    }

    updateUser.mutate({ id: currentUser.id, data }, {
      onSuccess: () => {
        toast({ title: "Profile updated successfully" });
        setCurrentPassword("");
        setNewPassword("");
        refetch();
      },
      onError: (err: any) => {
        toast({ title: "Update failed", description: err.message, variant: "destructive" });
      }
    });
  };

  if (!currentUser) return null;

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="container mx-auto px-4 md:px-6 py-12 max-w-4xl">
          <div className="mb-8">
            <h1 className="text-3xl font-heading font-bold">Account Settings</h1>
            <p className="text-muted-foreground mt-1">Manage your profile and account details.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Sidebar Cards */}
            <div className="space-y-6">
              <div className="bg-card border border-border/50 rounded-2xl p-6 text-center shadow-sm">
                <div className="relative w-24 h-24 mx-auto mb-4 group">
                  <Avatar className="w-full h-full border-4 border-background shadow-md">
                    <AvatarImage src={currentUser.avatar || ''} />
                    <AvatarFallback className="text-2xl">{currentUser.username.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div 
                    onClick={() => !isUploading && avatarRef.current?.click()}
                    className="absolute inset-0 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                  >
                    {isUploading ? <Loader2 className="h-6 w-6 animate-spin text-white" /> : <Camera className="h-6 w-6 text-white" />}
                  </div>
                  <input type="file" ref={avatarRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                </div>
                <h3 className="font-heading font-bold text-lg">{currentUser.username}</h3>
                <p className="text-sm text-muted-foreground">{currentUser.email}</p>
                <div className="mt-4 inline-flex items-center px-3 py-1 rounded-full bg-muted text-xs font-medium uppercase tracking-wider">
                  Role: {currentUser.role}
                </div>
              </div>

              <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Wallet className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Wallet Balance</p>
                    <p className="text-xl font-bold tracking-tight">Rp {currentUser.walletBalance?.toLocaleString() || 0}</p>
                  </div>
                </div>
                
                {currentUser.activeSubscription ? (
                  <div className="flex items-center gap-3 pt-4 border-t border-border/50">
                    <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                      <Crown className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-amber-600">Active Premium</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Expires: {new Date(currentUser.activeSubscription.endDate).toLocaleDateString()}</p>
                    </div>
                  </div>
                ) : (
                  <div className="pt-4 border-t border-border/50 text-center">
                    <p className="text-sm text-muted-foreground mb-3">No active subscription</p>
                  </div>
                )}
              </div>
            </div>

            {/* Edit Form */}
            <div className="md:col-span-2">
              <div className="bg-card border border-border/50 rounded-2xl p-6 md:p-8 shadow-sm">
                <h2 className="text-xl font-heading font-bold mb-6">Profile Details</h2>
                
                <form onSubmit={handleUpdateProfile} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input 
                      id="username" 
                      value={username} 
                      onChange={(e) => setUsername(e.target.value)} 
                      className="bg-background max-w-md"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input 
                      id="email" 
                      value={currentUser.email} 
                      disabled 
                      className="bg-muted text-muted-foreground max-w-md"
                    />
                    <p className="text-xs text-muted-foreground">Email address cannot be changed.</p>
                  </div>

                  <div className="pt-6 mt-6 border-t border-border/50">
                    <h3 className="text-lg font-heading font-semibold mb-4">Change Password</h3>
                    <div className="space-y-4 max-w-md">
                      <div className="space-y-2">
                        <Label htmlFor="current">Current Password</Label>
                        <Input 
                          id="current" 
                          type="password" 
                          placeholder="••••••••"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          className="bg-background"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new">New Password</Label>
                        <Input 
                          id="new" 
                          type="password" 
                          placeholder="••••••••"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="bg-background"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4">
                    <Button type="submit" disabled={updateUser.isPending}>
                      {updateUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save Changes
                    </Button>
                  </div>
                </form>
              </div>
            </div>

          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
