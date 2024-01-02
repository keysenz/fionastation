import Link from "next/link"
import useFio from "../../components/useFio"

function About(){
    const {play} = useFio()
    return (
        <>
        <div className="pointer-events-none fixed top-1 left-0 -z-10 h-border-screen w-screen bg-cover bg-center"/>
        <main className="container flex max-w-screen-md grow flex-col items-center justify-center text-white">
        <div className="relative z-0 mt-14 mb-8">
          <h1 className="z-0 text-center text-4xl font-black uppercase md:text-6xl text-[#446e92]">Fiona Clearesta</h1>
        </div>
        <div>
        <div className="mb-2 flex flex-col items-end justify-end sm:flex-row">
          <a href="https://twitter.com/FionaClearesta" className="md:text-[#446e92] text-shadow mr-2 hover:text-blue-900 sm:mr-4"><i className="fa-brands fa-twitter"></i> @FionaClearesta</a>
          <a href="https://www.youtube.com/@FionaClearesta" className="md:text-red-600 text-shadow hover:text-red-800"><i className="fa-brands fa-youtube"></i> Fiona Clearesta Ch.</a>
        </div>
        <div className="mt-4 mb-4 w-full max-w-screen-md border-4 bg-black/50 px-4 py-2 md:skew-x-12 md:border-x-6 md:px-10">
          <div className="flex h-full flex-col md:-skew-x-12">
            <p>Fiona Clearesta is Mystical White Rabbit from Underland who will bring happiness and joy to you! Fiona likes to sing in karaoke stream and sometimes humming in any other stream.
            She enjoy to play any horror, adventure or any game she had. She likes to cover japan song, but she sing to Japanese and Indonesian Song, you <b>should</b> check her karaoke stream.
            </p>
            <p>&nbsp;</p>
            <p>Fiona was a talent of Metanoia Phase II, now she is an indie vtuber. She plays a vast variety of games, you can see in her <a href="https://www.youtube.com/watch?v=J6mBKVM2478&list=PL-65lNPQcx_DKVV7RBmSqHnxcddL1a56F&pp=iAQB" target="_blank" rel="noreferrer" className="hover:text-fiona">Playlist</a>.  Notable games she plays are <a href="https://www.youtube.com/watch?v=hSVwVU7Q-h0&list=PL-65lNPQcx_Bcwn3fJOraRWv_0MwZJdWI" target="_blank" rel="noreferrer" className="hover:text-fiona">Resident Evil Series</a>, you would find her hilarous surprised reaction
              and some big brain move she made. She also enjoy Minecraft, Raft and any similiar games. 
            </p>
          </div>
        </div>
        </div>
        <a href="https://virtualyoutuber.fandom.com/id/wiki/Fiona_Clearesta" target="_blank" rel="noreferrer" className="mb-6 rounded border-2 border-black px-2 text-lg font-black text-[#446e92] uppercase  hover:text-fiona">Read More</a>
      <div className="z-10 flex w-full flex-col sm:w-3/4 md:w-2/3 lg:w-4/5">
        
        {/* <iframe className="aspect-video w-full rounded-md border-2 border-white" width="560" height="315" src="https://www.youtube.com/embed/l_nzwYCDkBI" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe> */}
      </div>
        <div className="grow"/>     
        <p className="text-shadow my-8 text-center text-sm text-black">
          Background credits :{" "}
          <a  rel="noopener noreferrer"
          target="_blank"
          href="https://twitter.com/MaroonR19"
          className="hover:text-[#446e92]">Maroon</a>{" "}
        </p>
        {/* <p className="display-hidden lg:display-block text-shadow my-8 text-center text-sm text-black backdrop-blur-lg">Fiona Clearesta artwork credit: (Left) <a href="https://twitter.com/MaroonR19" className="hover:text-fiona">@MaroonR19</a></p> */}
      </main>
      <Link href="/" className="fixed top-4 left-4">
        <i className="fa-arrow-left fa-2x fa-solid text-shadow text-[#446e92]"></i>
      </Link>
      </>
    )
}

export default About