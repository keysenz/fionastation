import React from 'react'
export default function SearchBar({search, searchBar, setSearch}) {
    return (
                <div className="w-full flex flex-col justify-center items-center">
                    <form className="w-full" onSubmit={searchBar}>
                        <div className="flex justify-center items-center ">
                            <div className="relative flex w-full lg:w-1/3 bg-white/5">
                                <input type="text" className="
                            object-center
                            items-center
                            text-center
                            mt-0
                            block
                            w-full
                            px-0.5
                            border-0 border-b-2 border-[#446e92]
                            focus:ring-0 focus:border-[#65afe6] bg-transparent text-[#40688e] placeholder-[#284864]" placeholder="Find the magical voice!!" 
                            name="song_title" value={search} onChange={(e)=>setSearch(e.target.value)}/>
                            <button type="submit" className="inset-y-0 right-0 relative w-4 h-12 ">
                            <svg className="fill-[#446e92]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z"/></svg> 
                            </button>
                            <button type="submit" onClick={()=>setSearch('')} className='ml-2 text-red-600 text-xl'><i className="fa-solid fa-xmark"></i></button>
                            </div>
                        </div>
                    </form>
                </div>
    )
}