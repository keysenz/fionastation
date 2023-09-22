import { supabase } from "../../lib/initSupabase";

export default async function  getKaraokeSingle(req, res){ 
    // get karaoke's title
    // get video url
    // make array
    // show title on off
    let {video_id} = req.query
    let { data, error } = await supabase.from('karaoke_video_duplicate')
    .select(`
        id, video_title, video_url, membership,
        karaoke_song_duplicate( id, song_title, timestamp, created_at )
        `)
    .eq('id',video_id).single()
    if(error) console.log(error)
    return res.json(data);
}