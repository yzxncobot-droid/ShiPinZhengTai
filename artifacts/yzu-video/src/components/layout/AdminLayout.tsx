import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useListNotifications } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard, Video, FolderOpen, Users, CreditCard, Wallet,
  ArrowUpFromLine, TrendingUp, Star, BarChart3, FileBarChart, Bell,
  Settings, ShieldCheck, Server, Upload, LogOut, Home, ChevronLeft,
  ChevronRight, Menu, PlaySquare, Search, User as UserIcon, X, Gift,
} from "lucide-react";

// ── Navigation Config ──────────────────────────────────────────────────────────
interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: number | null;
  exact?: boolean;
}
interface NavGroup {
  section: string | null;
  ownerOnly?: boolean;
  adminHide?: boolean;
  items: NavItem[];
}

const useNavGroups = (pendingPayments: number = 0, unreadNotifs: number = 0): NavGroup[] => [
  {
    section: null,
    items: [{ label: "Dashboard", href: "/admin", icon: LayoutDashboard, exact: true }],
  },
  {
    section: "Konten",
    items: [
      { label: "Videos", href: "/admin/videos", icon: Video },
      { label: "Kategori", href: "/admin/categories", icon: FolderOpen },
      { label: "Upload Video", href: "/admin/upload", icon: Upload },
      { label: "Bundles", href: "/admin/bundles", icon: Gift },
    ],
  },
  {
    section: "Pengguna",
    items: [{ label: "Users", href: "/admin/users", icon: Users }],
  },
  {
    section: "Keuangan",
    items: [
      { label: "Pembayaran", href: "/admin/payments", icon: CreditCard, badge: pendingPayments || null },
      { label: "Wallet", href: "/admin/wallet", icon: Wallet },
      { label: "Penarikan", href: "/admin/withdrawals", icon: ArrowUpFromLine },
      { label: "Pendapatan", href: "/admin/revenue", icon: TrendingUp },
      { label: "Langganan", href: "/admin/subscriptions", icon: Star },
    ],
  },
  {
    section: "Analitik",
    items: [
      { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
      { label: "Laporan", href: "/admin/reports", icon: FileBarChart },
    ],
  },
  {
    section: "Komunikasi",
    items: [{ label: "Notifikasi", href: "/admin/notifications-mgmt", icon: Bell, badge: unreadNotifs || null }],
  },
  {
    section: "Sistem",
    ownerOnly: true,
    items: [
      { label: "Pengaturan", href: "/admin/settings", icon: Settings },
      { label: "Audit Log", href: "/admin/audit-logs", icon: ShieldCheck },
      { label: "Sistem", href: "/admin/system", icon: Server },
    ],
  },
];

const PATH_LABELS: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/videos": "Videos",
  "/admin/categories": "Kategori",
  "/admin/upload": "Upload Video",
  "/admin/bundles": "Bundles",
  "/admin/users": "Users",
  "/admin/payments": "Pembayaran",
  "/admin/wallet": "Wallet",
  "/admin/withdrawals": "Penarikan",
  "/admin/revenue": "Pendapatan",
  "/admin/subscriptions": "Langganan",
  "/admin/analytics": "Analytics",
  "/admin/reports": "Laporan",
  "/admin/notifications-mgmt": "Notifikasi",
  "/admin/settings": "Pengaturan",
  "/admin/audit-logs": "Audit Log",
  "/admin/system": "Sistem",
};

// ── Sidebar Navigation Item ────────────────────────────────────────────────────
function NavLink({
  item, isActive, collapsed,
}: { item: NavItem; isActive: boolean; collapsed: boolean }) {
  const base =
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 w-full relative";
  const active = "bg-primary text-primary-foreground shadow-sm";
  const inactive = "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60";

  const inner = (
    <Link href={item.href}>
      <button className={`${base} ${isActive ? active : inactive}`}>
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="truncate">{item.label}</span>
            {item.badge != null && item.badge > 0 && (
              <Badge variant="destructive" className="ml-auto h-5 min-w-[20px] px-1 text-xs">
                {item.badge}
              </Badge>
            )}
          </>
        )}
        {collapsed && item.badge != null && item.badge > 0 && (
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
        )}
      </button>
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {item.label}
          {item.badge != null && item.badge > 0 && (
            <Badge variant="destructive" className="h-5 min-w-[20px] px-1 text-xs">{item.badge}</Badge>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }
  return inner;
}

// ── Sidebar Content ────────────────────────────────────────────────────────────
function SidebarContent({
  collapsed = false, onClose,
}: { collapsed?: boolean; onClose?: () => void }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const isOwner = user?.role === "owner";

  const { data: notifs } = useListNotifications({ query: { refetchInterval: 30000 } });
  const unreadNotifs = Array.isArray(notifs) ? notifs.filter((n: any) => !n.isRead).length : 0;

  const navGroups = useNavGroups(0, unreadNotifs);

  const isActive = (item: NavItem) =>
    item.exact ? location === item.href : location.startsWith(item.href);

  const handleLogout = () => {
    logout();
    setLocation("/login");
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className={`flex h-16 items-center border-b border-sidebar-border shrink-0 ${collapsed ? "justify-center px-2" : "px-4"}`}>
        <Link href="/">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shrink-0">
              <PlaySquare className="h-4 w-4 text-primary-foreground" />
            </div>
            {!collapsed && (
              <div>
                <p className="font-bold text-base leading-none">Yzu视频</p>
                <p className="text-xs text-sidebar-foreground/50 leading-none mt-0.5">
                  {isOwner ? "Owner Panel" : "Admin Panel"}
                </p>
              </div>
            )}
          </div>
        </Link>
        {onClose && (
          <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        <TooltipProvider delayDuration={0}>
          <nav className={`space-y-1 ${collapsed ? "px-2" : "px-3"}`}>
            {navGroups.map((group, gi) => {
              if (group.ownerOnly && !isOwner) return null;
              const visibleItems = group.items;
              if (visibleItems.length === 0) return null;
              return (
                <div key={gi} className={gi > 0 ? "pt-2" : ""}>
                  {group.section && !collapsed && (
                    <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                      {group.section}
                    </p>
                  )}
                  {collapsed && group.section && gi > 0 && <Separator className="my-2 opacity-30" />}
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => (
                      <NavLink key={item.href} item={item} isActive={isActive(item)} collapsed={collapsed} />
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>
        </TooltipProvider>
      </ScrollArea>

      {/* User Info */}
      <div className={`border-t border-sidebar-border p-3 space-y-1 shrink-0 ${collapsed ? "px-2" : ""}`}>
        {!collapsed ? (
          <>
            <Link href="/">
              <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60">
                <Home className="mr-2 h-4 w-4" />Kembali ke Aplikasi
              </Button>
            </Link>
            <div className="flex items-center gap-3 rounded-lg px-3 py-2 bg-sidebar-accent/30">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage src={user?.avatar ?? undefined} />
                <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                  {user?.username?.slice(0, 2).toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.username}</p>
                <Badge variant={user?.role === "owner" ? "default" : "secondary"} className="text-[10px] h-4 px-1 mt-0.5">
                  {user?.role}
                </Badge>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10" onClick={handleLogout}>
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/">
                  <Button variant="ghost" size="icon" className="w-full h-9 text-sidebar-foreground/60 hover:text-sidebar-foreground">
                    <Home className="h-4 w-4" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Kembali ke Aplikasi</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="w-full h-9 text-destructive hover:bg-destructive/10" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Logout</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}

// ── Top Header ─────────────────────────────────────────────────────────────────
function AdminHeader({
  collapsed, onToggle, mobileOpen, onMobileOpen,
}: { collapsed: boolean; onToggle: () => void; mobileOpen: boolean; onMobileOpen: (v: boolean) => void }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { data: notifs } = useListNotifications();
  const unread = Array.isArray(notifs) ? notifs.filter((n: any) => !n.isRead).length : 0;

  const label = PATH_LABELS[location] ?? "Dashboard";

  return (
    <header className="h-14 border-b bg-background/95 backdrop-blur flex items-center gap-3 px-4 shrink-0">
      {/* Mobile: hamburger */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden h-8 w-8">
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-72">
          <SidebarContent onClose={() => onMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Desktop: sidebar toggle */}
      <Button variant="ghost" size="icon" className="hidden md:flex h-8 w-8" onClick={onToggle}>
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </Button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground hidden sm:block">Admin</span>
        <span className="text-muted-foreground hidden sm:block">/</span>
        <span className="font-semibold">{label}</span>
      </div>

      <div className="flex-1" />

      {/* Search */}
      <div className="relative hidden lg:block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          className="h-8 w-56 rounded-md border bg-muted/50 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          placeholder="Cari..."
        />
      </div>

      {/* Notifications */}
      <Link href="/admin/notifications-mgmt">
        <Button variant="ghost" size="icon" className="h-8 w-8 relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
          )}
        </Button>
      </Link>

      {/* Profile Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
            <Avatar className="h-7 w-7">
              <AvatarImage src={user?.avatar ?? undefined} />
              <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                {user?.username?.slice(0, 2).toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>
            <div>
              <p className="font-medium">{user?.username}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link href="/profile"><span className="flex items-center gap-2"><UserIcon className="h-4 w-4" />Profil</span></Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href="/"><span className="flex items-center gap-2"><Home className="h-4 w-4" />Kembali ke Aplikasi</span></Link></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { logout(); setLocation("/login"); }}>
            <LogOut className="h-4 w-4 mr-2" />Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

// ── Main AdminLayout Export ────────────────────────────────────────────────────
export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("admin_sidebar_collapsed") === "true"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("admin_sidebar_collapsed", String(next)); } catch {}
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex flex-col border-r border-border bg-sidebar transition-all duration-300 shrink-0 ${collapsed ? "w-16" : "w-60"}`}
      >
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* Content */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <AdminHeader
          collapsed={collapsed}
          onToggle={toggle}
          mobileOpen={mobileOpen}
          onMobileOpen={setMobileOpen}
        />
        <main className="flex-1 overflow-y-auto bg-muted/20">
          {children}
        </main>
      </div>
    </div>
  );
}

// Alias for backward compat
export { AdminLayout as default };
