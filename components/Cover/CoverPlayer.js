
import React, { useEffect, useState, useRef } from 'react';
import YouTube from 'react-youtube';
import { BsChevronCompactLeft, BsChevronCompactRight, BsPlayFill, BsPauseFill, BsSkipEndFill, BsSkipStartFill, BsShuffle } from 'react-icons/bs';
import { BiRepeat } from 'react-icons/bi';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export default function CoverPlayer({ 
    video, 
    onNext, 
    onPrev, 
    autoplay, 
    onToggleAutoplay,
    isShuffle,
    onToggleShuffle
}) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [player, setPlayer] = useState(null);

    const onReady = (event) => {
        setPlayer(event.target);
    };

    const onStateChange = (event) => {
        // 1 = playing, 2 = paused
        setIsPlaying(event.data === 1);
        
        // 0 = ended
        if (event.data === 0 && autoplay) {
            onNext();
        }
    };

    // Sync play/pause button with player
    const togglePlay = () => {
        if (!player) return;
        if (isPlaying) {
            player.pauseVideo();
        } else {
            player.playVideo();
        }
    };

    return (
        <div className="w-full max-w-4xl mx-auto flex flex-col gap-6">
            {/* Main Player Card with Glassmorphism */}
            <div className="relative group w-full aspect-video rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-black/40 backdrop-blur-md">
                <div className="absolute inset-0 z-0">
                    <YouTube
                        videoId={video?.video_id}
                        className="w-full h-full"
                        iframeClassName="w-full h-full"
                        opts={{
                            width: '100%',
                            height: '100%',
                            playerVars: {
                                autoplay: 1,
                                controls: 1, // Keep youtube controls for accessibility/advanced features
                                showinfo: 0,
                                rel: 0,
                                modestbranding: 1
                            }
                        }}
                        onReady={onReady}
                        onStateChange={onStateChange}
                    />
                </div>
            </div>

            {/* Controls & Meta Data Card */}
            <div className="w-full p-6 rounded-3xl bg-white/10 backdrop-blur-xl border border-white/10 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4 text-white">
                
                {/* Song Info */}
                <div className="flex-1 text-center md:text-left min-w-0">
                    <h2 className="text-2xl font-bold truncate tracking-tight text-white mb-1">
                        {video?.title || "Select a song"}
                    </h2>
                    <p className="text-white/40 text-sm mt-1 italic group-hover:text-blue-400/50 transition-colors">You don&apos;t have to be alone...</p>
                    <p className="text-sm text-blue-200/80 font-medium">
                        Fiona&apos;s Cover
                    </p>
                </div>

                {/* Playback Controls */}
                <div className="flex items-center gap-6">
                    {/* Shuffle Toggle */}
                    <button 
                         onClick={onToggleShuffle}
                         className={twMerge(
                             "p-2 rounded-full transition-all hover:bg-white/10 active:scale-95",
                             isShuffle ? "text-blue-400" : "text-white/50"
                         )}
                         title="Shuffle"
                    >
                        <BsShuffle size={20} />
                    </button>

                    <button 
                        onClick={onPrev}
                        className="p-3 rounded-full hover:bg-white/10 active:scale-95 transition-all text-white"
                        title="Previous"
                    >
                        <BsSkipStartFill size={28} />
                    </button>

                    <button 
                        onClick={onNext}
                        className="p-3 rounded-full hover:bg-white/10 active:scale-95 transition-all text-white"
                        title="Next"
                    >
                        <BsSkipEndFill size={28} />
                    </button>
                    
                     {/* Autoplay Toggle */}
                     <button 
                         onClick={onToggleAutoplay}
                         className={twMerge(
                             "p-2 rounded-full transition-all hover:bg-white/10 active:scale-95 flex items-center gap-2",
                             autoplay ? "text-blue-400 bg-blue-500/10" : "text-white/50"
                         )}
                         title="Autoplay Next"
                    >
                        <BiRepeat size={20} />
                        {/* <span className="text-xs font-bold hidden md:inline">AUTO</span> */}
                    </button>
                </div>
            </div>
        </div>
    );
}
