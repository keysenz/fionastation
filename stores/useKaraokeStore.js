import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const useKaraokeStore = create(
  persist(
    (set, get) => ({
      // State
      queue: [],
      history: [],
      currentSong: null,
      isPlaying: false,
      isExpanded: false,
      isQueueOpen: false, // New: Control sidebar queue visibility
      filter: {
        search: '',
        category: 'All', // All, Karaoke, Stream Archive, Favorites
      },
      
      // Actions
      setFilter: (newFilter) => set((state) => ({ 
        filter: { ...state.filter, ...newFilter } 
      })),
      
      setCurrentSong: (song) => {
          const { history, currentSong } = get();
          let newHistory = history;
          if (currentSong) {
             // Add previous song to history, avoid duplicates at top of stack if needed
             newHistory = [currentSong, ...history].slice(0, 50); // Keep last 50
          }
          set({ currentSong: song, history: newHistory, isPlaying: true });
      },

      addToQueue: (song) => set((state) => ({ 
        queue: [...state.queue, song] 
      })),

      playNext: () => {
        const { queue } = get();
        if (queue.length > 0) {
          const nextSong = queue[0];
          const remainingQueue = queue.slice(1);
          get().setCurrentSong(nextSong);
          set({ queue: remainingQueue });
        } else {
            // Optional: Auto-play logic could go here or be handled by the component
            set({ isPlaying: false });
        }
      },

      playPrevious: () => {
          const { history } = get();
           if (history.length > 0) {
              const prevSong = history[0];
              const remainingHistory = history.slice(1);
              // We might want to push current song back to queue or just switch?
              // For simplicity, just switch to prev
              set({ currentSong: prevSong, history: remainingHistory, isPlaying: true });
           }
      },
      
      togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
      
      setExpanded: (expanded) => set({ isExpanded: expanded }),
      toggleQueue: () => set((state) => ({ isQueueOpen: !state.isQueueOpen })),
      
      // Helper to clear queue
      clearQueue: () => set({ queue: [] }),
    }),
    {
      name: 'karaoke-storage', // name of the item in the storage (must be unique)
      storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
      partialize: (state) => ({ 
          history: state.history,
          queue: state.queue,
          // We generally don't persist playing state or current song across reloads 
          // unless desired, but user asked for queue/history persistence.
      }),
    }
  )
);

export default useKaraokeStore;
