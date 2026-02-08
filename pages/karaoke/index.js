import { useEffect, useState, useMemo } from "react";
import useSWR from 'swr';
import YouTube from "react-youtube";
import Fuse from 'fuse.js';
import Link from "next/link";
import { useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import { twMerge } from "tailwind-merge";

import useKaraokeStore from '../../stores/useKaraokeStore';
import PlayerBar from '../../components/Karaoke/PlayerBar';
import FilterBar from '../../components/Karaoke/FilterBar';
import QueueDrawer from '../../components/Karaoke/QueueDrawer';
import SongListItem from '../../components/Karaoke/SongListItem';

// Fetcher for SWR
const fetcher = (...args) => fetch(...args).then(res => res.json());

function Karaoke() {
  const searchParams = useSearchParams();
  const idQuery = searchParams.get('id');

  // Global State
  const { 
    currentSong, isPlaying, isExpanded, filter, isQueueOpen,
    setCurrentSong, togglePlay, playNext, addToQueue, setExpanded, toggleQueue
  } = useKaraokeStore();

  // Local State for YouTube Player
  const [player, setPlayer] = useState(null);

  // Data Fetching
  const { data, isLoading } = useSWR("/api/get-karaoke", fetcher);

  // Flatten Data for Searching
  const allSongs = useMemo(() => {
    if (!data) return [];
    return data.flatMap(video => 
        (video.karaoke_song || []).map(song => ({
            ...song,
            // Attach parent video info with normalization
            video_url: video.video_url,
            // Normalize title: video_title (DB) vs title_text (expected)
            title_text: video.video_title || video.title_text || "Unknown Stream", 
            channel_name: video.channel_name || "Fiona", 
            membership: video.membership
        }))
    );
  }, [data]);

  // Handle Query Param (Deep Linking)
  useEffect(() => {
    if (data && idQuery && !currentSong) {
       // Deep linking logic can be added here
    }
  }, [data, idQuery, currentSong]);

  // Fuzzy Search Setup
  const fuse = useMemo(() => {
    return new Fuse(allSongs, {
        keys: ['song_title', 'title_text'], // title_text is normalized now
        threshold: 0.4, 
    });
  }, [allSongs]);

  // Filtered Results
  const filteredSongs = useMemo(() => {
    let result = allSongs;

    // 1. Text Search
    if (filter.search.trim()) {
        result = fuse.search(filter.search).map(r => r.item);
    }
    
    // 2. Category Filter (Example logic)
    if (filter.category !== 'All') {
        // Placeholder for category logic if data supports it
    }

    return result;
  }, [filter, allSongs, fuse]);


  // Helper to parse HH:MM:SS or MM:SS to seconds
  const parseTimestampToSeconds = (timestamp) => {
    if (!timestamp) return 0;
    const parts = String(timestamp).split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return isNaN(parts[0]) ? 0 : parts[0];
  };

  // YouTube Player Options
  const opts = useMemo(() => ({
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 1, // Auto-play when loaded
      controls: 1,
      modestbranding: 1,
      start: parseTimestampToSeconds(currentSong?.timestamp),
    },
  }), [currentSong]);

  // Sync Player State with Store
  useEffect(() => {
      if (player && currentSong && typeof player.playVideo === 'function') {
          try {
              // Check if the player is ready/valid (sometimes getIframe is available check)
              if (player.getIframe && !player.getIframe()) return;

              if (isPlaying) player.playVideo();
              else player.pauseVideo();
          } catch (e) {
              console.error("Error controlling player:", e);
          }
      }
  }, [isPlaying, player, currentSong]);

  // Clear player ref if song changes (prevents accessing dead iframe from previous song)
  useEffect(() => {
      setPlayer(null);
  }, [currentSong]);

  // Player Event Handlers
  const onReady = (event) => {
      setPlayer(event.target);
      if (isPlaying) event.target.playVideo();
  };

  const onStateChange = (event) => {
      // 1 = Playing, 2 = Paused, 0 = Ended
      const state = event.data;
      if (state === 1 && !isPlaying) useKaraokeStore.setState({ isPlaying: true });
      if (state === 2 && isPlaying) useKaraokeStore.setState({ isPlaying: false });
      
      if (state === 0) {
          const { queue } = useKaraokeStore.getState();
          if (queue.length > 0) {
              playNext(); // Play from queue
          } else if (currentSong) {
              // Autoplay: Find next song in the overall list
              const currentIndex = allSongs.findIndex(s => s.id === currentSong.id);
              if (currentIndex !== -1 && currentIndex < allSongs.length - 1) {
                  const nextSong = allSongs[currentIndex + 1];
                  setCurrentSong(nextSong);
              } else {
                  useKaraokeStore.setState({ isPlaying: false });
              }
          }
      }
  };

  return (
    <div className="flex flex-col h-screen text-white overflow-hidden font-sans relative">
      {/* Top Navigation / Filter - COMPACT HEADER */}
      <div className="flex-none px-4 pt-4 pb-2 z-20">
         <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-3">
                 <Link href="/" className="text-gray-400 hover:text-white drop-shadow-md">
                    <i className="fas fa-arrow-left fa-lg"></i>
                </Link>
                <h1 className="text-xl font-bold tracking-tight text-[#446e92] uppercase drop-shadow-md">Karaoke</h1>
            </div>
            
            {/* Header Actions - Search is here now, Queue button removed from flex logic */}
         </div>
         
         {/* Search Input */}
         <div className="mb-2 relative">
             <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                <i className="fas fa-search"></i>
             </div>
             <input 
                type="text" 
                placeholder="Search songs..." 
                className="w-full bg-black/50 backdrop-blur-md text-white rounded-full py-2 pl-12 pr-4 text-sm border border-white/10 focus:border-[#446e92] focus:outline-none transition-all shadow-lg"
                value={filter.search}
                onChange={(e) => useKaraokeStore.getState().setFilter({ search: e.target.value })}
             />
         </div>

         <FilterBar />
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 min-h-0 relative">
          
          {/* Left: Song List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
              {isLoading ? (
                  <div className="flex justify-center items-center h-40">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                  </div>
              ) : (
                  <div className="space-y-1 pb-24">
                      {filteredSongs.length > 0 ? (
                           filteredSongs.map((song, i) => (
                              <SongListItem key={`${song.video_url}-${song.song_title}-${i}`} song={song} video={{ video_url: song.video_url, title_text: song.title_text }} />
                           ))
                      ) : (
                          <div className="text-center text-gray-200 mt-10 p-4 bg-black/40 rounded-lg backdrop-blur-sm mx-auto max-w-md">
                              <p className="font-semibold">No songs found for &quot;{filter.search}&quot;</p>
                              {allSongs.length === 0 && <p className="text-sm mt-2 opacity-75">Connecting to archive...</p>}
                          </div>
                      )}
                  </div>
              )}
          </div>

          {/* Right: Queue Drawer - SLIDING WITH HANDLE */}
          <div 
             className={twMerge(
                "fixed top-0 bottom-0 right-0 z-40 flex items-center transition-transform duration-300 ease-in-out",
                isQueueOpen ? "translate-x-0" : "translate-x-[20rem]" // Slide just enough to hide drawer (w-80 = 20rem) but keep handle
             )}
          >
              {/* The Handle */}
              <button 
                  onClick={toggleQueue}
                  className="w-10 h-40 bg-[#446e92]/90 backdrop-blur-md rounded-l-2xl flex flex-col items-center justify-center shadow-[-4px_0_15px_rgba(0,0,0,0.5)] cursor-pointer hover:bg-[#578bb8] active:bg-[#3a5d7c] transition-all border-l border-t border-b border-white/20 gap-6 group"
              >
                   {/* Icon changes based on state */}
                   <i className={`fas fa-chevron-${isQueueOpen ? 'right' : 'left'} text-white/80 group-hover:text-white transition-colors`}></i>
                   
                   <span className="text-[11px] uppercase font-bold tracking-[0.2em] -rotate-90 whitespace-nowrap text-white/90 group-hover:text-white transition-colors">Queue</span>
                   
                   {/* Badge inside handle */}
                   {useKaraokeStore.getState().queue.length > 0 && (
                       <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(248,113,113,0.8)]"></div>
                   )}
              </button>

              {/* The Drawer Content */}
              <div className="w-80 h-full bg-black/80 backdrop-blur-xl border-l border-white/10 shadow-2xl">
                   <QueueDrawer className="bg-transparent h-full" />
              </div>
          </div>

      </div>

      {/* Persistent Player Bar */}
      <PlayerBar />

      {/* 
         Video Player Container 
         Stays mounted but changes visibility/layout
      */}
      {currentSong && (
           <div 
                className={`fixed transition-all duration-500 shadow-2xl overflow-hidden z-50 bg-black/95 backdrop-blur-xl flex flex-col
                    ${isExpanded 
                        ? 'inset-0' // Full Screen
                        : 'w-1 h-1 opacity-0 pointer-events-none bottom-0 right-0' // Hidden state
                    }
                `}
           >
                <div className={`relative w-full ${isExpanded ? 'h-full flex flex-col' : 'h-1'}`}>
                     {/* Header in Expanded Mode */}
                     <div className={`${isExpanded ? 'flex' : 'hidden'} justify-between p-4 absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/80 to-transparent`}> 
                         <button onClick={() => setExpanded(false)} className="text-white hover:text-[#446e92] p-2">
                             <i className="fas fa-chevron-down fa-2x"></i>
                         </button>
                     </div>

                     {/* The Player Wrapper */}
                     <div className={`flex items-center justify-center bg-transparent ${isExpanded ? 'flex-1' : ''}`}>
                         <div className={`${isExpanded ? 'w-full max-w-6xl aspect-video shadow-2xl' : 'w-full h-full'}`}>
                             <YouTube
                                videoId={currentSong.video_url}
                                opts={opts}
                                onReady={onReady}
                                onStateChange={onStateChange}
                                className="w-full h-full"
                             />
                         </div>
                     </div>
                     
                     {/* Info in Expanded Mode */}
                     <div className={`${isExpanded ? 'block' : 'hidden'} p-8 pb-32 w-full max-w-4xl mx-auto`}>
                          <h1 className="text-2xl md:text-3xl font-bold text-center mb-2 drop-shadow-lg">{currentSong.song_title}</h1>
                          <p className="text-center text-gray-400 mb-8">{currentSong.title_text}</p>
                          
                          {/* Expanded Queue Preview */}
                          <div className="bg-white/5 backdrop-blur-md rounded-xl p-6 border border-white/10">
                              <h3 className="text-gray-400 mb-4 uppercase text-xs tracking-wider font-bold">Up Next</h3>
                              {useKaraokeStore.getState().queue.length > 0 ? (
                                   <div className="space-y-3">
                                       {useKaraokeStore.getState().queue.slice(0, 3).map((qSong, idx) => (
                                           <div key={idx} className="flex items-center space-x-3 text-sm">
                                               <span className="text-gray-500">{idx + 1}</span>
                                               <span className="text-white truncate">{qSong.song_title}</span>
                                           </div>
                                       ))}
                                   </div>
                              ) : <p className="text-gray-500 italic">Queue is empty</p>}
                          </div>
                     </div>
                </div>
           </div>
      )}

    </div>
  );
}

export default Karaoke;
