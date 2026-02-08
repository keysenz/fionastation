import useKaraokeStore from '../../stores/useKaraokeStore';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export default function PlayerBar() {
  const { currentSong, isPlaying, togglePlay, playNext, playPrevious, isExpanded, setExpanded } = useKaraokeStore();

  if (!currentSong) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-xl border-t border-white/10 text-white z-50 h-20 flex items-center px-4 shadow-2xl transition-all duration-300">
      {/* Progress Bar (Visual only for now, can be hooked up later) */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-white/10 cursor-pointer group">
         <div className="h-full bg-sky-500 w-0 group-hover:bg-sky-400 relative transition-all duration-300"> 
            {/* We need actual progress state to animate this */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 shadow-lg scale-0 group-hover:scale-100 transition-all"></div>
         </div>
      </div>
      
      {/* Left: Song Info */}
      <div className="flex items-center space-x-4 w-1/3">
        <div className="relative group cursor-pointer" onClick={() => setExpanded(!isExpanded)}>
             {/* Thumbnail */}
            <div className={`transition-all duration-300 ${isExpanded ? 'w-0 h-0 opacity-0' : 'w-14 h-14 bg-gray-800 rounded overflow-hidden shadow-lg border border-white/10'}`}>
             <img src={`https://img.youtube.com/vi/${currentSong.video_url || 'default'}/default.jpg`} alt="art" className="w-full h-full object-cover"/>
                 <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <i className="fas fa-chevron-up text-white drop-shadow-md"></i>
                 </div>
            </div>
        </div>
        
        <div className="min-w-0">
          <h3 className="font-bold text-sm truncate drop-shadow-sm">{currentSong.song_title}</h3>
          <p className="text-xs text-gray-400 truncate">Karaoke Archive</p>
        </div>
      </div>

      {/* Center: Controls */}
      <div className="flex flex-col items-center justify-center w-1/3">
        <div className="flex items-center space-x-6">
          <button onClick={playPrevious} className="text-gray-300 hover:text-white transition hover:scale-110 active:scale-95">
            <i className="fas fa-step-backward fa-lg drop-shadow-md"></i>
          </button>
          
          <button 
            onClick={togglePlay} 
            className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-110 active:scale-95 transition shadow-lg hover:shadow-sky-500/20"
          >
             {isPlaying ? <i className="fas fa-pause"></i> : <i className="fas fa-play pl-1"></i>}
          </button>
          
          <button onClick={playNext} className="text-gray-300 hover:text-white transition hover:scale-110 active:scale-95">
            <i className="fas fa-step-forward fa-lg drop-shadow-md"></i>
          </button>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center justify-end space-x-4 w-1/3">
          <button onClick={() => setExpanded(!isExpanded)} className="text-gray-300 hover:text-white transition hover:rotate-90">
             {/* Expand Icon */}
             <i className="fas fa-expand drop-shadow-md"></i>
          </button>
      </div>
    </div>
  );
}
