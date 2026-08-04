import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListVideos } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { VideoCard, VideoCardSkeleton } from "@/components/video/VideoCard";
import { useState, useEffect } from "react";
import { Search as SearchIcon, Filter, PlaySquare } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SearchPage() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const initialQuery = searchParams.get('q') || '';
  
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);

  const { data: videos, isLoading } = useListVideos({ search: activeQuery, limit: 24 }, {
    query: { enabled: activeQuery.length > 0 }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setActiveQuery(query);
      // We don't really need to push state to URL since we're SPA but good practice
      window.history.replaceState({}, '', `/search?q=${encodeURIComponent(query)}`);
    }
  };

  useEffect(() => {
    // Just to ensure UI matches URL initially
    if (initialQuery && initialQuery !== activeQuery) {
      setActiveQuery(initialQuery);
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  return (
    <AppLayout>
      <div className="container mx-auto px-4 md:px-6 py-8">
        <form onSubmit={handleSearch} className="max-w-3xl mx-auto mb-12">
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <SearchIcon className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for videos, creators, or categories..."
              className="pl-12 pr-24 h-14 rounded-full bg-card border-border/50 text-base shadow-sm focus-visible:ring-primary/20"
            />
            <div className="absolute inset-y-0 right-1 flex items-center">
              <Button type="submit" size="sm" className="rounded-full h-10 px-6">
                Search
              </Button>
            </div>
          </div>
        </form>

        {activeQuery ? (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-heading font-medium">
                Results for "<span className="text-primary font-bold">{activeQuery}</span>"
              </h2>
              <Button variant="outline" size="sm" className="rounded-full border-border/50">
                <Filter className="h-4 w-4 mr-2" /> Filter
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {isLoading ? (
                Array(8).fill(0).map((_, i) => <VideoCardSkeleton key={i} />)
              ) : videos?.data.length === 0 ? (
                <div className="col-span-full py-20 text-center text-muted-foreground">
                  <SearchIcon className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <h3 className="text-xl font-heading font-semibold text-foreground mb-2">No results found</h3>
                  <p>Try different keywords or remove filters.</p>
                </div>
              ) : (
                videos?.data.map((video: any) => (
                  <VideoCard key={video.id} video={video} />
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="py-20 text-center flex flex-col items-center">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <PlaySquare className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-2xl font-heading font-bold mb-2">Search the Library</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Find your favorite videos, discover new content, and explore our massive collection.
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
