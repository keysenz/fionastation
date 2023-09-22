import { Inter } from '@next/font/google'
import Menu from '../components/menu'

const inter = Inter({ subsets: ['latin'] })

export default function Home() {
  return (
    <>
      <div className="pointer-events-none fixed top-1 left-0 -z-10 h-border-screen w-screen bg-cover bg-center"/>
      <main className="container flex max-w-screen-md grow flex-col items-center justify-center">
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
