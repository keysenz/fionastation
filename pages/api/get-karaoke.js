import { supabase } from "../../lib/initSupabase";

export default async function  getKaraoke(req, res){ 
    // get karaoke's title
    // get video url
    // make array
    // show title on off
    let { data, error } = await supabase.from('karaoke_video')
    .select(`
        id, video_title, video_url, membership,
        karaoke_song( id, song_title, timestamp, created_at )
        `)
    .order('published_at', {ascending: false})
    .order('timestamp', {ascending: true, foreignTable: 'karaoke_song'})   
    if(error) console.log(error)
    
    data = data.map((v) => {
        let karaoke = v.karaoke_song.map((kar) => {
        return { ...kar, visible: false, search: false };
        });
        return { ...v, karaoke_song: karaoke, visible: false, visible_count: 0 };
    });
    return res.json(data);
}