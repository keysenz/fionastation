import useKaraokeStore from '../../stores/useKaraokeStore';
import { clsx } from "clsx";
import { twMerge } from 'tailwind-merge';

export default function QueueDrawer({ className }) {
  const { queue, history, currentSong, playNext, addToQueue } = useKaraokeStore();

  return (
    <div className={twMerge("flex flex-col h-full bg-black/40 backdrop-blur-md border-l border-white/10 text-white overflow-hidden", className)}>
      <div className="p-4 border-b border-white/10 bg-white/5">
        <h2 className="text-lg font-bold drop-shadow-md">Up Next</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {queue.length === 0 ? (
          <div className="text-center text-gray-300 text-sm py-10 opacity-75">
            Queue is empty
          </div>
        ) : (
          queue.map((song, i) => (
            <div key={`${song.id}-${i}`} className="flex items-center space-x-3 group p-2 rounded hover:bg-white/10 transition-colors">
              <div className="text-gray-400 text-xs w-4">{i + 1}</div>
               {/* Tiny Thumbnail if available, else placeholder */}
              <div className="w-10 h-10 bg-slate-800 rounded flex-shrink-0 overflow-hidden shadow-sm">
                  <img src={`https://img.youtube.com/vi/${song.video_url || 'default'}/default.jpg`} alt="art" className="w-full h-full object-cover opacity-80"/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate group-hover:text-sky-300 cursor-pointer text-white drop-shadow-sm">{song.song_title}</p>
                <p className="text-xs text-gray-300 truncate">Karaoke</p>
              </div>
            </div>
          ))
        )}

        {history.length > 0 && (
            <>
                <div className="pt-4 border-t border-white/10 mt-4">
                    <h3 className="text-sm font-semibold text-gray-400 mb-2 px-2 uppercase tracking-wider">History</h3>
                </div>
                 {history.map((song, i) => (
                    <div key={`hist-${song.id}-${i}`} className="flex items-center space-x-3 opacity-60 hover:opacity-100 transition-opacity p-2 rounded hover:bg-white/5">
                    <div className="w-8 h-8 bg-slate-800 rounded flex-shrink-0 overflow-hidden">
                        <img src={`https://img.youtube.com/vi/${song.video_url || 'default'}/default.jpg`} alt="art" className="w-full h-full object-cover"/>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm truncate text-gray-200">{song.song_title}</p>
                    </div>
                    </div>
                ))}
            </>
        )}
      </div>
    </div>
  );
}
