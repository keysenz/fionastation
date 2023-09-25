import { Inter } from '@next/font/google'
import Menu from '../components/menu'
import { useRef } from 'react';

const inter = Inter({ subsets: ['latin'] })

export default function Home() {
  
  const promotion = useRef();
  return (
    <>
      <div className="pointer-events-none fixed top-1 left-0 -z-10 h-border-screen w-screen bg-cover bg-center"/>
      <main className="container flex max-w-screen-md grow flex-col items-center justify-center"> 
      <div className="fixed top-0 left-0 z-50 flex h-screen w-screen flex-col items-center justify-center bg-gray-900/50 px-2" ref={promotion}>
          <iframe src="https://www.youtube.com/embed/jmFyo0pYC08?playlist=jmFyo0pYC08&loop=1"
            className="mb-4 aspect-video w-full rounded sm:w-3/4 md:w-2/3 lg:w-4/5"
            title="YouTube video player" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; loop" allowFullScreen />
          <div className="flex gap-4">
            <a href="https://www.youtube.com/channel/UCb-cLXWVOGVJHfkIfHt8Dfg?sub_confirmation=1" target="_blank" rel="noreferrer" className="blinking rounded bg-[#ff0000] px-2 text-xl">Subscribe Fiona~~</a>
            <button className="rounded bg-gray-500 px-2 text-xl hover:bg-amber-200" onClick={() => promotion.current.remove()}>Skip Fiona&apos;s Owi Song</button>
          </div>
        </div>
        <div className="relative z-0 mb-14 mt-28">
          <h1 className="z-0 text-center text-4xl font-black uppercase md:text-7xl text-[#446e92]">
            Fiona <br />
            <span>Station</span>
          </h1>
        </div>
        <div className='mb-12 flex flex-col md:flex-row gap-6 md:gap-12'>
          <Menu href="/about" src="fionawave.webp">About</Menu>
          <Menu href="/karaoke" src="FioLove.webp">Karaoke</Menu>
          <Menu href="/cover" src="FioWah.webp">Cover</Menu>
          <Menu href="/credits" src="FioManteb.webp">Credits</Menu>
        </div>
        <div className='grow' />
        <p className="text-shadow my-8 text-center text-sm text-black backdrop-blur-lg">
          Background credits :{" "}
          <a  rel="noopener noreferrer"
          target="_blank"
          href="https://twitter.com/MaroonR19"
          className="hover:text-[#446e92]">Maroon</a>{" "}
        </p>
      </main>
    </>
  )
}
