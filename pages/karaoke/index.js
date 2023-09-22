import { useEffect, useRef, useState } from "react";
import SearchBar from "../../components/KaraokeSearch/SearchBar";
import SearchResult from "../../components/KaraokeSearch/SearchResult";
import { axiosInstance } from "../../lib/axiosInstance";
import Link from "next/link";
import YouTube from "react-youtube";
import toSeconds from "../../lib/hoursConverter";
import useSWR from 'swr';
import useFio from "../../components/useFio";

function Karaoke() {
  const [titleShow, setTitleShow] = useState("");
  const [search, setSearch] = useState("");
  const [videos, setVideos] = useState([]);
  // const [isLoading, setLoading] = useState(true);
  const [player, setPlayer] = useState();
  const [autoPlay, setAutoplay] = useState(false)
  const [timestamp, setTimestamp] = useState(0)
  const [index, setIndex] = useState(0)
  const [curVid, setCurVid] = useState({})
  const [playerTime, setPlayerTime] = useState(0)
  const {play} = useFio()
  const videoUrl = curVid?.video_url

  const fetcher = (...args) => fetch(...args).then(res => res.json())

  const {data, isLoading} = useSWR("/api/get-karaoke", fetcher)

  const opts = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      controls: 1,
    },
  };

  if(titleShow)
    document.title = titleShow

  const onSearch = (event) => {
    event.preventDefault();
    let videosList = Object.assign([], videos);
    videosList.map((video) => {
      let visible = false;
      video.karaoke_song = video.karaoke_song.map((song) => {
        if (
          search !== "" &&
          song.song_title.toLowerCase().includes(search.toLowerCase())
        ) {
          visible = true;
          return { ...song, visible: true, search: true };
        }
        return { ...song, visible: false, search: false };
      });
      video.visible = visible;
      video.visible_count = visible ? 1 : 0;
      return { ...video };
    });
    setVideos(videosList);
  };

  const minimized = (id, open) => {
    let videosList = Object.assign([], videos);
    videosList.map((video) => {
      if (video.id === id) {
        video.visible = open;
        video.karaoke_song = video.karaoke_song.map((song) => {
          return { ...song, visible: song.search ? true : open };
        });
        video.visible_count = 0;
      }
      return { ...video };
    });
    setVideos(videosList);
  };


  useEffect(() => {
    const checkTime = setInterval(
      ()=>{ 
        if(player){
          const currentTime = player.getCurrentTime()
          setPlayerTime((e)=> currentTime)
        }
      }, 5000
    )
    return () => {
      clearInterval(checkTime)
    }
  }, [player])

  useEffect(() => {
    if(data) {
      setVideos(data);
      setCurVid(data.find(v=>!v.membership));
    }
  }, [data]);
  

  useEffect(()=>{
    const i = index
    const vid = curVid
    if(player && videoUrl == vid.video_url)
      if(i < (vid.karaoke_song.length-1) && playerTime > toSeconds(vid.karaoke_song[i+1].timestamp)){
          const newIndex = i+1
          setIndex(newIndex)
          setTitleShow(vid.karaoke_song[newIndex].song_title)
        }
},[playerTime])

  return (
    <>
      <main className="container flex min-h-border-screen flex-col items-center justify-center">
        <div className="relative z-0 mb-8 mt-14">
          <h1 className="z-0 text-center text-2xl font-black uppercase md:text-6xl text-[#446e92]">
            Fiona&apos;s Karaoke <br /> Archive
          </h1>
        </div>
        {titleShow ? (
          <div className="rounded-lg backdrop-blur-sm z-0 p-3 text-center text-xl md:text-4xl uppercase bg-sky-400/30 text-[#446e92] mb-2">
            <h3>{titleShow}</h3>
          </div>
        ) : (
          <></>
        )}
        <SearchBar searchBar={onSearch} search={search} setSearch={setSearch} />
        <div className="mt-8 w-full lg:flex lg:items-start lg:justify-center lg:h-[32rem]">
          <div className="lg:basis-5/12 items-center justify-center lg:h-[32rem] md:overflow-auto">
            {isLoading ? (
              <></>
            ) : (
              videos.map((video, i) => (
                <SearchResult
                  key={i}
                  video={video}
                  minimized={minimized}
                  setTitleShow={setTitleShow}
                  Url={curVid.video_url}
                  player={player}
                  setAutoplay={setAutoplay}
                  setTimestamp={setTimestamp}
                  setIndex={setIndex}
                  setCurVid={setCurVid}
                  setPlayer={setPlayer}
                />
              ))
            )}
          </div>
          <div className="lg:basis-7/12 lg:mt-0 lg:ml-4 lg:h-[32rem]">
            {
            !curVid?.membership ?
            <YouTube
              key={videoUrl}
              className="flex w-full aspect-video justify-center items-center"
              iframeClassName="w-full"
              videoId={videoUrl}
              opts={opts}
              onReady={(event) => {
                setPlayer(event.target);
                if(autoPlay){
                  event.target.seekTo(timestamp)
                  event.target.playVideo()
                }
              }}
            /> : <div className="flex flex-col w-full aspect-video justify-center items-center border-solid bg-black/50 text-white p-4 gap-2">
              This video is membership only, You can click the Youtube Icon to redirect to the said video and be a member there.
              <br/>
            <a 
          rel="noopener noreferrer"
          target="_blank" href={`https://www.youtube.com/watch?v=${videoUrl}`} className="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-lg flex items-center space-x-2">
              <i className="fab fa-youtube"></i>
              <span>Watch on YouTube</span>
            </a>
            </div>
            }
          </div>
        </div>
        <div className="grow" />
        <p className="lg-text-shadow p-2 text-center text-sm text-black lg-backdrop-blur-lg">
          Timestamp credits :{" "}
          <span className="hover:text-[#446e92]">SuryaA</span>,{" "}
          <span className="hover:text-[#446e92]">Bembot</span>,{" "}
          <span className="hover:text-[#446e92]">Bang Nugs</span>,{" "}
          <span className="hover:text-[#446e92]">ヤミアクマ</span>
          Background credits :&nbsp;
          <a  rel="noopener noreferrer"
          target="_blank"
          href="https://twitter.com/MaroonR19"
          className="hover:text-[#446e92]">Maroon</a>{" "}

        </p>
        <Link href="/" className="fixed top-4 left-4" onClick={play}>
          <i className="fa-arrow-left fa-2x fa-solid text-shadow text-[#446e92]"></i>
        </Link>
      </main>
    </>
  );
}

export default Karaoke;
