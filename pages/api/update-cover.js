import axios from "axios";
import { supabase } from "../../lib/initSupabase";

export default async function UpdateCover(req, res){ 
  const fetchPlaylistVideos = async () => {
    try {
      const playlistId = 'PL-65lNPQcx_CZ_JCxF3sODkAV2XiBH3ML';
      const apiKey = process.env.GOOGLE_API_KEY;

      const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&key=${apiKey}`
      );
      const {data} = response
      for (const dat of data.items) {
        try{
            const {data:rec, error} =  await supabase.from('sing_video').insert({
                title : dat.snippet.title,
                video_id : dat.snippet.resourceId.videoId,
                published_at : dat.snippet.publishedAt
                
            })
        } catch (e){
            console.log(e);
            continue;
        }
      }
      res.json(data)
    }
    catch(e){
        console.log(e);
    }
    }
    fetchPlaylistVideos()
}