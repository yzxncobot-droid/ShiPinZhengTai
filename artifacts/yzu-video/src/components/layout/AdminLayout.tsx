import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  BarChart3, 
  Video, 
  Users, 
  FolderTree, 
  CreditCard, 
  Settings as SettingsIcon, 
  Upload, 
  Home, 
  LogOut,
  PlaySquare
} from "lucide-react";

export function AdminSidebar() {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();

  const handleLogout = () => {
    logout();
    setLocation('/login');
  };

  const isOwner = user?.role === 'owner';

  return (
    <div className="hidden border-r bg-sidebar md:block md:w-64 lg:w-72 shrink-0">
      <div className="flex h-full max-h-screen flex-col">
        <div className="flex h-16 items-center border-b px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <PlaySquare className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-xl tracking-tight text-sidebar-foreground">Yzu<span className="text-primary">视频</span> {isOwner ? 'Owner' : 'Admin'}</span>
          </Link>
        </div>
        <ScrollArea className="flex-1 px-4 py-6">
          <nav className="flex flex-col gap-1 space-y-1">
            <div className="px-2 py-1.5 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
              Overview
            </div>
            
            <Link href={isOwner ? "/owner" : "/admin"}>
              <Button 
                variant={location === (isOwner ? "/owner" : "/admin") ? "secondary" : "ghost"} 
                className={`w-full justify-start ${location === (isOwner ? "/owner" : "/admin") ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
              >
                <BarChart3 className="mr-3 h-4 w-4" />
                Dashboard
              </Button>
            </Link>

            <Separator className="my-4" />

            <div className="px-2 py-1.5 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
              Content
            </div>
            
            <Link href={isOwner ? "/owner/videos" : "/admin/videos"}>
              <Button 
                variant={location.startsWith(isOwner ? "/owner/videos" : "/admin/videos") ? "secondary" : "ghost"} 
                className={`w-full justify-start ${location.startsWith(isOwner ? "/owner/videos" : "/admin/videos") ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
              >
                <Video className="mr-3 h-4 w-4" />
                {isOwner ? "All Videos" : "My Videos"}
              </Button>
            </Link>

            <Link href="/admin/upload">
              <Button 
                variant={location === "/admin/upload" ? "secondary" : "ghost"} 
                className={`w-full justify-start ${location === "/admin/upload" ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
              >
                <Upload className="mr-3 h-4 w-4" />
                Upload Video
              </Button>
            </Link>

            {isOwner && (
              <>
                <Link href="/owner/categories">
                  <Button 
                    variant={location.startsWith("/owner/categories") ? "secondary" : "ghost"} 
                    className={`w-full justify-start ${location.startsWith("/owner/categories") ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
                  >
                    <FolderTree className="mr-3 h-4 w-4" />
                    Categories
                  </Button>
                </Link>
                
                <Separator className="my-4" />
                
                <div className="px-2 py-1.5 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                  Management
                </div>

                <Link href="/owner/users">
                  <Button 
                    variant={location.startsWith("/owner/users") ? "secondary" : "ghost"} 
                    className={`w-full justify-start ${location.startsWith("/owner/users") ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
                  >
                    <Users className="mr-3 h-4 w-4" />
                    Users
                  </Button>
                </Link>

                <Link href="/owner/payments">
                  <Button 
                    variant={location.startsWith("/owner/payments") ? "secondary" : "ghost"} 
                    className={`w-full justify-start ${location.startsWith("/owner/payments") ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
                  >
                    <CreditCard className="mr-3 h-4 w-4" />
                    Payments & Top-ups
                  </Button>
                </Link>

                <Link href="/owner/subscriptions">
                  <Button 
                    variant={location.startsWith("/owner/subscriptions") ? "secondary" : "ghost"} 
                    className={`w-full justify-start ${location.startsWith("/owner/subscriptions") ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
                  >
                    <Crown className="mr-3 h-4 w-4" />
                    Subscription Plans
                  </Button>
                </Link>

                <Separator className="my-4" />

                <div className="px-2 py-1.5 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                  System
                </div>

                <Link href="/owner/settings">
                  <Button 
                    variant={location.startsWith("/owner/settings") ? "secondary" : "ghost"} 
                    className={`w-full justify-start ${location.startsWith("/owner/settings") ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"}`}
                  >
                    <SettingsIcon className="mr-3 h-4 w-4" />
                    Settings
                  </Button>
                </Link>
              </>
            )}
          </nav>
        </ScrollArea>
        <div className="border-t p-4">
          <Link href="/">
            <Button variant="ghost" className="w-full justify-start mb-2 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50">
              <Home className="mr-3 h-4 w-4" />
              Back to Main App
            </Button>
          </Link>
          <Button variant="ghost" onClick={handleLogout} className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10">
            <LogOut className="mr-3 h-4 w-4" />
            Log out
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground">
      <AdminSidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex h-16 items-center justify-between border-b px-4 bg-card shrink-0">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <PlaySquare className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-xl tracking-tight">Yzu<span className="text-primary">视频</span></span>
          </Link>
          <Button variant="outline" size="sm" onClick={() => setLocation('/')}>Exit Dashboard</Button>
        </header>
        
        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-muted/20">
          {children}
        </main>
      </div>
    </div>
  );
}

// Ensure Crown is imported if used (already imported above if needed, wait, didn't import Crown)
// Adding Crown to lucide-react imports above
import { Crown } from "lucide-react";