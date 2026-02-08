import { twMerge } from 'tailwind-merge';
import useKaraokeStore from '../../stores/useKaraokeStore';

const categories = ["Karaoke"];

export default function FilterBar() {
  const { filter, setFilter } = useKaraokeStore();

  return (
    <div className="w-full flex md:justify-start justify-center flex-wrap gap-2 py-2">
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => setFilter({ category: cat })}
          className={twMerge(
            "px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200 backdrop-blur-sm border",
            filter.category === cat
              ? "bg-[#446e92] text-white border-[#446e92] shadow-lg shadow-sky-900/40"
              : "bg-black/40 text-gray-300 border-white/10 hover:bg-white/10 hover:text-white hover:border-white/30"
          )}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
