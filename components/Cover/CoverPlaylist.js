
import React, { useState, useMemo } from 'react';
import Fuse from 'fuse.js';
import { BsSearch, BsPlayFill, BsMusicNoteBeamed } from 'react-icons/bs';
import { twMerge } from 'tailwind-merge';

export default function CoverPlaylist({ 
    videos = [], 
    currentVideo, 
    onSelect, 
    className 
}) {
    const [search, setSearch] = useState('');

    const fuse = useMemo(() => {
        return new Fuse(videos, {
            keys: ['title'],
            threshold: 0.4
        });
    }, [videos]);

    const filteredVideos = useMemo(() => {
        if (!search) return videos;
        return fuse.search(search).map(result => result.item);
    }, [search, videos, fuse]);

    return (
        <div className={twMerge("flex flex-col h-full bg-white/5 backdrop-blur-xl border-l border-white/10 md:w-80 lg:w-96", className)}>
            {/* Search Header */}
            <div className="p-4 border-b border-white/10 bg-black/20">
                <div className="relative">
                    <BsSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input 
                        type="text"
                        placeholder="Search covers..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-white/10 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-light"
                    />
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent p-2">
                {filteredVideos.map((video, idx) => {
                    const isActive = currentVideo?.id === video.id; // Assuming video has an ID, fall back to index if needed
                    
                    return (
                        <button
                            key={video.id || idx}
                            onClick={() => onSelect(video)}
                            className={twMerge(
                                "w-full text-left p-3 rounded-lg flex items-center gap-3 transition-all group mb-1",
                                isActive 
                                    ? "bg-blue-600/20 border border-blue-500/30 text-white" 
                                    : "hover:bg-white/5 text-white/80 hover:text-white border border-transparent"
                            )}
                        >
                            <div className={twMerge(
                                "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                                isActive ? "bg-blue-500 text-white" : "bg-white/10 group-hover:bg-white/20 text-white/50"
                            )}>
                                {isActive ? <BsPlayFill size={20} /> : <BsMusicNoteBeamed size={18} />}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                                <h3 className={twMerge(
                                    "font-medium truncate text-sm",
                                    isActive ? "text-white" : "text-white/90"
                                )}>
                                    {video.title}
                                </h3>
                                {/* Assuming published_at exists based on previous code */}
                                {/* <p className="text-xs text-white/40 truncate">
                                    {new Date(video.published_at).toLocaleDateString()}
                                </p> */}
                            </div>

                            {isActive && (
                                <div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.6)] animate-pulse" />
                            )}
                        </button>
                    );
                })}

                {filteredVideos.length === 0 && (
                    <div className="p-8 text-center text-white/40 italic">
                        No songs found
                    </div>
                )}
            </div>
            
            <div className="p-3 text-xs text-white/30 text-center border-t border-white/10">
                {filteredVideos.length} Songs Loaded
            </div>
        </div>
    );
}
