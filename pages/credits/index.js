import Link from "next/link";
import useFio from "../../components/useFio";

function Credit() {
  const {play} = useFio()
  return (
    <>
      <main className="container flex max-w-screen-md grow flex-col items-center justify-center text-[#446e92]">
        <div className="relative z-0 mt-14 mb-8">
          <h1 className="z-0 text-center text-4xl font-black uppercase md:text-6xl text-[#446e92]">
            Credits
          </h1>
        </div>
        <div className="mt-4 mb-4 w-full max-w-screen-md border-4 bg-black/50 px-4 py-2 md:skew-x-12 md:border-x-6 md:px-10 text-white">
          <div className="flex h-full flex-col md:-skew-x-12">
            <p>
              This is Fanmade website to support Fiona Clearesta, if you like vtuber
              with cute voice and very good singing skill, you like to watch
              vtuber play adventure game and humming to isekai song (you will
              know what is isekai song if u listen to her), you <b>MUST</b>{" "}
              watch 
            </p>
            <h2 className="text-center">
              <b>
                <a href="https://www.youtube.com/@FionaClearesta/streams"
                  rel="noopener noreferrer"
                  target="_blank"
                  className="hover:text-fiona"><i className="fa-brands fa-youtube text-red-600"></i> Fiona&apos;s Stream</a></b>
            </h2>
            <p>
              Other than to promote our Kewinci this site also try to promote
              pyon talent, so dont feel shy to contribute 😉
            </p>
            <p>
              If u want to contribute to this project u can contact me in
              Discord{" "}
              <a
                href="http://discordapp.com/users/244661517356761089"
                className="hover:text-violet-300"
                rel="noopener noreferrer"
                target="_blank"
              >
                <i className="fa-brands fa-discord"> Keysenz </i>
              </a>
              . We accept art, video, and music. Any contribution to site will
              be credited in this site.
            </p>
            <p>&nbsp;</p>
            <p>
              You could also join{" "}
              <a
                href="https://discord.gg/vwfzuDFJA2"
                className="text-violet-300 hover:text-violet-500"
                rel="noopener noreferrer"
                target="_blank"
              >
                <i className="fa-brands fa-discord">
                  {" "}
                  Rumah Kewinci Inc.{" "}
                </i>
              </a>{" "}
              to share your fanart, clip or play game together, and of course utilize your youtube membership here.
            </p>
          </div>
        </div>
        <h2 className="mb-4 text-4xl font-black uppercase md:text-6xl text-[#446e92]">
          Credits
        </h2>
        <ul className="bg-black/30 w-full p-4 text-white">
          <li className="flex">
            Keysenz
            <span className="w-4 flex-grow" /> Website
          </li>
          <li className="flex">
            SuryaA
            <span className="w-4 flex-grow" /> Karaoke Timestamp
          </li>
          <li className="flex">
            Bembot
            <span className="w-4 flex-grow" /> Karaoke Timestamp
          </li>
          <li className="flex">
            Bang Nugs
            <span className="w-4 flex-grow" /> Karaoke Timestamp
          </li>
          <li className="flex">
            ヤミアクマ
            <span className="w-4 flex-grow" /> Karaoke Timestamp
          </li>
          <li className="mb-4 text-4xl font-black uppercase md:text-6xl text-center text-[#446e92]">
            Artwork
          </li>
          <li className="flex items-center">
            MaroonR19
            <span className="w-4 flex-grow" /> Website Background
          </li>
          <li className="flex items-center">
            handryaraart
            <span className="w-4 flex-grow" /> Menu Emoticon
          </li>
          <li>
            <p className="text-2xl text-center">
              HELP ME TO FILL THIS CREDITS <br /> PAGE WITH YOUR NAME {':)'}
            </p>
          </li>
        </ul>
        <div className="grow" />
      </main>
      <Link href="/" className="fixed top-4 left-4" onClick={play}>
        <i className="fa-arrow-left fa-2x fa-solid text-shadow text-[#446e92]"></i>
      </Link>
    </>
  );
}

export default Credit;
