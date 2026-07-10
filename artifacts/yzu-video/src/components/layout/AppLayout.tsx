import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useGetSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { PlaySquare, Search, User, Wallet, Bell, History, Crown, LayoutDashboard, LogOut, Menu, MessageCircle, Send, Globe2 } from "lucide-react";
import { SiInstagram, SiTiktok, SiFacebook, SiYoutube, SiDiscord } from "react-icons/si";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function Navbar() {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();

  const handleLogout = () => {
    logout();
    setLocation('/login');
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center px-4 md:px-6">
        <div className="flex items-center gap-6 md:gap-10">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <PlaySquare className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="hidden font-heading font-bold text-xl tracking-tight sm:inline-block">Yzu<span className="text-primary">视频</span></span>
          </Link>
          
          <nav className="hidden md:flex gap-6">
            <Link href="/" className={`text-sm font-medium transition-colors hover:text-primary ${location === '/' ? 'text-primary' : 'text-muted-foreground'}`}>
              Home
            </Link>
            <Link href="/subscriptions" className={`text-sm font-medium transition-colors hover:text-primary ${location === '/subscriptions' ? 'text-primary' : 'text-muted-foreground'}`}>
              Premium
            </Link>
            <Link href="/leaderboard" className={`text-sm font-medium transition-colors hover:text-primary ${location === '/leaderboard' ? 'text-primary' : 'text-muted-foreground'}`}>
              Leaderboard
            </Link>
          </nav>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 md:gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation('/search')}>
            <Search className="h-5 w-5" />
            <span className="sr-only">Search</span>
          </Button>

          {user ? (
            <>
              <Link href="/notifications">
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="h-5 w-5" />
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
                  <span className="sr-only">Notifications</span>
                </Button>
              </Link>
              
              <Link href="/topup" className="hidden sm:flex">
                <Button variant="outline" className="gap-2 border-primary/20 bg-primary/5 hover:bg-primary/10">
                  <Wallet className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-primary">Rp {user.walletBalance?.toLocaleString() || 0}</span>
                </Button>
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                    <Avatar className="h-9 w-9 border border-border">
                      <AvatarImage src={user.avatar || ""} alt={user.username} />
                      <AvatarFallback className="bg-secondary text-secondary-foreground">{user.username.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user.username}</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                    {user.activeSubscription && (
                      <div className="mt-2">
                        <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-none w-fit">
                          <Crown className="mr-1 h-3 w-3" />
                          {user.activeSubscription.subscription?.name || 'Premium'} Active
                        </Badge>
                      </div>
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  
                  {(user.role === 'admin' || user.role === 'owner') && (
                    <>
                      <DropdownMenuItem onClick={() => setLocation(user.role === 'owner' ? '/owner' : '/admin')} className="cursor-pointer">
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        <span>Dashboard</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  
                  <DropdownMenuItem onClick={() => setLocation('/profile')} className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/history')} className="cursor-pointer">
                    <History className="mr-2 h-4 w-4" />
                    <span>History</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/topup')} className="cursor-pointer sm:hidden">
                    <Wallet className="mr-2 h-4 w-4" />
                    <span>Top-up Wallet</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive focus:bg-destructive/10">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setLocation('/login')} className="hidden sm:inline-flex">
                Log in
              </Button>
              <Button onClick={() => setLocation('/register')}>
                Sign up
              </Button>
            </div>
          )}

          {/* Mobile Menu */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px] sm:w-[400px]">
              <div className="flex flex-col gap-6 py-4">
                <Link href="/" className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                    <PlaySquare className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <span className="font-heading font-bold text-xl tracking-tight">Yzu<span className="text-primary">视频</span></span>
                </Link>
                
                <nav className="flex flex-col gap-4">
                  <Link href="/" className={`text-sm font-medium ${location === '/' ? 'text-primary' : 'text-foreground'}`}>Home</Link>
                  <Link href="/subscriptions" className={`text-sm font-medium ${location === '/subscriptions' ? 'text-primary' : 'text-foreground'}`}>Premium Plans</Link>
                  <Link href="/leaderboard" className={`text-sm font-medium ${location === '/leaderboard' ? 'text-primary' : 'text-foreground'}`}>Leaderboard</Link>
                </nav>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

const SOCIAL_LINKS = [
  { key: "instagramLink" as const, label: "Instagram", Icon: SiInstagram, hover: "hover:bg-[#E4405F] hover:text-white" },
  { key: "tiktokLink" as const, label: "TikTok", Icon: SiTiktok, hover: "hover:bg-black hover:text-white" },
  { key: "facebookLink" as const, label: "Facebook", Icon: SiFacebook, hover: "hover:bg-[#1877F2] hover:text-white" },
  { key: "youtubeLink" as const, label: "YouTube", Icon: SiYoutube, hover: "hover:bg-[#FF0000] hover:text-white" },
  { key: "discordLink" as const, label: "Discord", Icon: SiDiscord, hover: "hover:bg-[#5865F2] hover:text-white" },
];

export function Footer() {
  const { data: settings } = useGetSettings();
  const siteName = settings?.siteName || "Yzu视频";
  const socials = SOCIAL_LINKS.filter((s) => !!(settings as any)?.[s.key]);
  const hasContact = !!settings?.whatsappLink || !!settings?.telegramLink;

  return (
    <footer className="border-t py-12 md:py-16">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4 md:col-span-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <PlaySquare className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-heading font-bold text-xl tracking-tight">
                {siteName.replace(/视频$/, "")}
                {siteName.includes("视频") && <span className="text-primary">视频</span>}
              </span>
            </div>
            <p className="text-muted-foreground text-sm max-w-sm">
              {settings?.footerText || "The premium video streaming platform. Discover, watch, and support your favorite creators in a high-quality, immersive environment."}
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="font-heading font-semibold">Links</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/" className="hover:text-primary transition-colors">Home</Link></li>
              <li><Link href="/subscriptions" className="hover:text-primary transition-colors">Premium</Link></li>
              <li><Link href="/leaderboard" className="hover:text-primary transition-colors">Leaderboard</Link></li>
              <li><Link href="/search" className="hover:text-primary transition-colors">Search</Link></li>
            </ul>
          </div>

          {/* Hubungi Kami — sourced from Settings, hidden entirely when nothing is configured */}
          <div className="space-y-4">
            <h4 className="font-heading font-semibold">Hubungi Kami</h4>
            {hasContact ? (
              <ul className="space-y-2 text-sm text-muted-foreground">
                {settings?.whatsappLink && (
                  <li>
                    <a href={settings.whatsappLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-primary transition-colors">
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  </li>
                )}
                {settings?.telegramLink && (
                  <li>
                    <a href={settings.telegramLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-primary transition-colors">
                      <Send className="h-4 w-4" /> Telegram
                    </a>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground/60">Belum ada kontak dikonfigurasi</p>
            )}
          </div>

          {/* Media Sosial — sourced from Settings, hidden entirely when nothing is configured */}
          <div className="space-y-4">
            <h4 className="font-heading font-semibold">Media Sosial</h4>
            {socials.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {socials.map(({ key, label, Icon, hover }) => (
                  <a
                    key={key}
                    href={(settings as any)[key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    title={label}
                    className={`flex h-9 w-9 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground transition-colors ${hover}`}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60">Belum ada media sosial</p>
            )}
          </div>
        </div>

        <div className="mt-12 pt-8 border-t text-center text-sm text-muted-foreground flex flex-col md:flex-row justify-between items-center">
          <p>© {new Date().getFullYear()} {siteName}. All rights reserved.</p>
          <div className="mt-4 md:mt-0 flex gap-4">
            <span className="text-primary font-medium tracking-wider text-xs uppercase flex items-center gap-1">
              <Globe2 className="h-3.5 w-3.5" /> Premium Streaming
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-background text-foreground">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
