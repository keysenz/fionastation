import getYouTubeVideoSnippet from "../../lib/getYoutubeSnippet";
import { supabase } from "../../lib/initSupabase";

export default async function  postKaraoke(req, res){ 
    if (req.method !== 'POST') {
        res.status(405).send({ message: 'Only POST requests allowed' })
        return
    }
    let { url, karaoke } = req.body
    let { data:record, error } = await supabase
    .from("karaoke_video")
    .select("video_url,id")
    .eq("video_url", url).limit(1).single();

    if (record === null){
        let {publishedAt, title, thumbnails} = await getYouTubeVideoSnippet(url)
        const {data} = await supabase
        .from("karaoke_video")
        .upsert({
            video_title: title,
            video_url: url,
            membership: false,
            thumbnail: thumbnails.high.url,
            published_at: publishedAt
        })
        .select()
        .single()
        record = data
    } 
    let lists = karaoke.split(/\n/)
    for (const list of lists) {
        const [time, title] = list.split(/;/);
        let insertRecord = {
            song_title: title,
            timestamp: time,
            video_id: record.id
        }
        
        let { data:song } = await supabase
        .from("karaoke_song")
        .select("id")
        .eq("song_title", title)
        .eq("timestamp", time)
        .eq("video_id", record.id);
        if (song.length > 0) continue
        try {
            await supabase
            .from("karaoke_song")
            .insert(insertRecord)
        } catch (error) {
            console.log(error)
            continue
        }
        }
    return res.json(record);
}