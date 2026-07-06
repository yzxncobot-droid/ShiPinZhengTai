import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { PlaySquare, Search, User, Wallet, Bell, History, Crown, LayoutDashboard, LogOut, Menu } from "lucide-react";
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

export function Footer() {
  return (
    <footer className="border-t py-12 md:py-16">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4 md:col-span-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <PlaySquare className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-heading font-bold text-xl tracking-tight">Yzu<span className="text-primary">视频</span></span>
            </div>
            <p className="text-muted-foreground text-sm max-w-sm">
              The premium video streaming platform. Discover, watch, and support your favorite creators in a high-quality, immersive environment.
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
          
          <div className="space-y-4">
            <h4 className="font-heading font-semibold">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#" className="hover:text-primary transition-colors">Terms of Service</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Contact Us</a></li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t text-center text-sm text-muted-foreground flex flex-col md:flex-row justify-between items-center">
          <p>© {new Date().getFullYear()} Yzu视频. All rights reserved.</p>
          <div className="mt-4 md:mt-0 flex gap-4">
            <span className="text-primary font-medium tracking-wider text-xs uppercase">Premium Streaming</span>
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
