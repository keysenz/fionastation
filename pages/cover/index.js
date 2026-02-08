
import { useEffect, useState, useMemo } from "react";
import { BsList, BsX } from "react-icons/bs";
import Link from "next/link";
import useSWR from "swr";
import useFio from "../../components/useFio";
import CoverPlayer from "../../components/Cover/CoverPlayer";
import CoverPlaylist from "../../components/Cover/CoverPlaylist";
import { twMerge } from "tailwind-merge";

const fetcher = (...args) => fetch(...args).then(res => res.json())

export default function Cover() {
  const { play } = useFio();
  const { data: videos, isLoading } = useSWR("/api/get-cover", fetcher);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);

  // Initialize random index if shuffle is on, otherwise 0?
  // Actually, better to just let user pick or start at 0.

  const currentVideo = useMemo(() => {
    if (!videos || videos.length === 0) return null;
    return videos[currentIndex];
  }, [videos, currentIndex]);

  const handleNext = () => {
    if (!videos || videos.length === 0) return;
    
    if (isShuffle) {
      const randomIndex = Math.floor(Math.random() * videos.length);
      setCurrentIndex(randomIndex);
    } else {
      setCurrentIndex((prev) => (prev + 1) % videos.length);
    }
  };

  const handlePrev = () => {
    if (!videos || videos.length === 0) return;
    
    if (isShuffle) {
      const randomIndex = Math.floor(Math.random() * videos.length);
      setCurrentIndex(randomIndex);
    } else {
      setCurrentIndex((prev) => (prev - 1 + videos.length) % videos.length);
    }
  };

  const handleSelect = (video) => {
    const index = videos.findIndex(v => v.id === video.id);
    if (index !== -1) {
      setCurrentIndex(index);
      setShowPlaylist(false); // Close drawer on mobile selection
    }
  };

  // Dynamic background style
  const backgroundStyle = currentVideo ? {
      backgroundImage: `url(https://img.youtube.com/vi/${currentVideo.video_id}/maxresdefault.jpg)`,
  } : {};

  return (
    <div className="relative min-h-screen bg-black overflow-hidden font-sans text-slate-200">
      
      {/* Dynamic Background - Hidden on mobile as requested for performance/ux */}
      <div 
        className="fixed inset-0 z-0 hidden md:block opacity-30 bg-cover bg-center blur-3xl scale-110 transition-all duration-1000 ease-in-out"
        style={backgroundStyle}
      />
      
      {/* Static Dark Background for Mobile */}
      <div className="fixed inset-0 z-0 md:hidden bg-gradient-to-b from-slate-900 to-black" />

      {/* Main Layout */}
      <main className="relative z-10 flex flex-col h-screen">
        
        {/* Navbar / Header */}
        <header className="flex items-center justify-between px-6 py-4 bg-black/20 backdrop-blur-md border-b border-white/10 shrink-0">
            <Link href="/" onClick={play} className="group flex items-center gap-2 text-white/70 hover:text-white transition-colors">
                 <i className="fa-arrow-left text-xl group-hover:-translate-x-1 transition-transform"></i>
                 <span className="font-medium hidden sm:inline">Back to Home</span>
            </Link>

            <h1 className="text-xl font-bold tracking-widest uppercase text-white/90">
                Fiona<span className="text-blue-400">&apos;</span>s Covers
            </h1>

            <button 
                onClick={() => setShowPlaylist(!showPlaylist)}
                className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all text-white md:hidden"
            >
                {showPlaylist ? <BsX size={28} /> : <BsList size={28} />}
            </button>
        </header>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden relative">
            
            {/* Player Section */}
            <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 overflow-y-auto">
                {isLoading ? (
                    <div className="animate-pulse flex flex-col items-center gap-4">
                        <div className="w-full max-w-4xl aspect-video bg-white/5 rounded-3xl" />
                        <div className="w-full max-w-4xl h-24 bg-white/5 rounded-3xl" />
                    </div>
                ) : (
                    <CoverPlayer 
                        video={currentVideo}
                        onNext={handleNext}
                        onPrev={handlePrev}
                        autoplay={autoplay}
                        onToggleAutoplay={() => setAutoplay(!autoplay)}
                        isShuffle={isShuffle}
                        onToggleShuffle={() => setIsShuffle(!isShuffle)}
                    />
                )}

                 <div className="mt-8 text-center text-sm text-white/30">
                    Background credits: <a href="https://twitter.com/MaroonR19" target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 underline decoration-blue-400/30">Maroon</a>
                </div>
            </div>

            {/* Playlist Sidebar (Desktop) */}
            <div className="hidden md:block h-full border-l border-white/10 w-80 lg:w-96 shrink-0 bg-black/20 backdrop-blur-xl">
                 <CoverPlaylist 
                    videos={videos}
                    currentVideo={currentVideo}
                    onSelect={handleSelect}
                 />
            </div>

             {/* Playlist Drawer (Mobile) */}
             <div className={twMerge(
                 "absolute inset-0 z-20 bg-slate-900/95 backdrop-blur-xl transition-transform duration-300 md:hidden",
                 showPlaylist ? "translate-x-0" : "translate-x-full"
             )}>
                 <div className="flex flex-col h-full">
                     <div className="flex items-center justify-between p-4 border-b border-white/10">
                         <h2 className="text-lg font-bold text-white">Playlist</h2>
                         <button onClick={() => setShowPlaylist(false)} className="p-2 text-white/70 hover:text-white">
                             <BsX size={28} />
                         </button>
                     </div>
                     <CoverPlaylist 
                        videos={videos}
                        currentVideo={currentVideo}
                        onSelect={handleSelect}
                        className="w-full bg-transparent border-none"
                     />
                 </div>
             </div>

        </div>
      </main>
    </div>
  );
}
