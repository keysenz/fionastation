import getYouTubeVideoSnippet from "../../lib/getYoutubeSnippet";
import { supabase } from "../../lib/initSupabase";

export default async function  UpdateKaraoke(req, res){ 
    let { data:record, error } = await supabase
    .from("karaoke_video")
    .select("id, video_url")

    for (const rec of record) {
        let {publishedAt} = await getYouTubeVideoSnippet(rec.video_url)
        const {data, error} = await supabase
        .from("karaoke_video")
        .upsert({
            ...rec,
            published_at: publishedAt
        })   
        console.log(error)
    }
    return res.json(record);
}