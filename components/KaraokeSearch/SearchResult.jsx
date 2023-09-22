import React from "react";
import Image from "next/image";
import toSeconds from "../../lib/hoursConverter";

export default function SearchResult({
  video,
  Url,
  minimized,
  setTitleShow,
  player,
  setAutoplay,
  setTimestamp,
  setIndex,
  setCurVid,
  setPlayer
}) {
  const open = video.visible === false || video?.visible_count > 0;

  const onClickTimeStamp = (song, i) => {
    if (Url !== video.video_url) {
      if(player)
        player.pauseVideo()
      if(video.membership){
        setPlayer(null)
      } else{
        setTimestamp(toSeconds(song.timestamp))
      }
      setCurVid(video)
    } else {
      if(player){
        player.playVideo();
        player.seekTo(toSeconds(song.timestamp));
      }
    }
    setIndex(i)
    setTitleShow(song.song_title);
    setAutoplay(true)
  };

  const visibleList = (song, i) => {
    return song.visible === false ? (
      <></>
    ) : (
      <span>
        {song.song_title} <span className="text-white">|</span>{" "}
        <span
          className="text-white cursor-pointer"
          onClick={() => {
            if(video.membership)
              window.open(`https://youtu.be/${video.video_url}?t=${toSeconds(
                song.timestamp
              )}`, '_blank', 'noreferrer')
            onClickTimeStamp(song, i);
          }}
        >
          {song.timestamp}
        </span>
        <a
          rel="noopener noreferrer"
          target="_blank"
          href={`https://youtu.be/${video.video_url}?t=${toSeconds(
            song.timestamp
          )}`}
        >
          &nbsp;&nbsp;<i className="fab fa-youtube text-red-600"></i>
        </a>{" "}
      </span>
    );
  };
  return (
    <div className=" bg-white/5 text-white mb-2">
      <div className="flex items-center flex-nowrap">
        <h1 className="bg-white/70 text-black grow">{video.video_title}</h1>
        <button
          className="bg-white text-black text-center w-[20px] min-w-[20px] self-stretch"
          onClick={() => minimized(video.id, open)}
        >
          {open ? "+" : "-"}
        </button>
      </div>
      <div className="bg-black/50">
        <ol className={"text-[#85caff] list-inside list-decimal"}>
          {video.karaoke_song.map((song, i) => (
            <li
              className={song?.visible === false ? "fadeOut" : "fadeIn"}
              key={song.id}
            >
              {visibleList(song, i)}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
