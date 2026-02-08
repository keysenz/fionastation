import useKaraokeStore from '../../stores/useKaraokeStore';
import { twMerge } from 'tailwind-merge';

export default function SongListItem({ song, video }) {
  const { setCurrentSong, addToQueue, currentSong, isPlaying, togglePlay } = useKaraokeStore();

  const isCurrent = currentSong?.id === song.id; 

  const handlePlay = () => {
    if (isCurrent) {
      togglePlay();
    } else {
        const songData = {
            ...song,
            video_url: video.video_url, 
            channel_name: video.channel_name,
        };
        setCurrentSong(songData);
    }
  };

  const handleQueue = (e) => {
      e.stopPropagation();
      const songData = {
        ...song,
        video_url: video.video_url,
      };
      addToQueue(songData);
  }

  return (
    <div 
      className={twMerge(
          "group flex items-center justify-between p-3 rounded-lg transition-all cursor-pointer border border-transparent backdrop-blur-sm",
          "hover:bg-white/10 hover:border-white/5",
          isCurrent 
            ? 'bg-sky-900/40 border-sky-500/30 shadow-[0_0_15px_rgba(14,165,233,0.1)]' 
            : 'bg-black/20 hover:shadow-lg'
      )}
      onClick={handlePlay}
    >
      <div className="flex items-center space-x-4 flex-1 min-w-0">
        {/* Thumbnail / Icon */}
        <div className={twMerge(
            "relative w-12 h-12 rounded overflow-hidden bg-slate-800 flex-shrink-0 shadow-md transition-transform",
            "group-hover:scale-105"
        )}>
           <img src={`https://img.youtube.com/vi/${video.video_url}/default.jpg`} alt="thumb" className={`w-full h-full object-cover transition-opacity ${isCurrent ? 'opacity-40' : 'opacity-80 group-hover:opacity-100'}`} />
           <div className={`absolute inset-0 flex items-center justify-center ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} bg-black/40 transition-opacity`}>
              {isCurrent && isPlaying ? (
                  <i className="fas fa-chart-bar animate-pulse text-white drop-shadow-md"></i> 
              ) : (
                  <i className="fas fa-play text-white drop-shadow-md"></i>
              )}
           </div>
        </div>

        {/* Text Info */}
        <div className="flex-col min-w-0">
          <h4 className={twMerge(
              "font-medium text-sm truncate drop-shadow-sm transition-colors",
              isCurrent ? 'text-sky-300' : 'text-white group-hover:text-sky-200'
          )}>{song.song_title}</h4>
          <p className="text-xs text-gray-300 truncate opacity-80 group-hover:opacity-100 transition-opacity">
            {video.video_title || video.title_text || "Unknown Stream"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center px-1">
        <button 
            onClick={handleQueue}
            className={twMerge(
                "flex items-center space-x-2 px-3 py-2 rounded-full transition-all active:scale-95",
                "bg-white/5 border border-white/10 text-gray-400 font-bold",
                "hover:bg-[#446e92]/20 hover:border-[#446e92]/50 hover:text-white",
                "opacity-0 group-hover:opacity-100" // Keep it clean, only show on hover
            )}
        >
          <i className="fas fa-list-ul text-xs"></i>
          <span className="text-[10px] uppercase tracking-widest whitespace-nowrap">Add to Queue</span>
        </button>
      </div>
    </div>
  );
}
