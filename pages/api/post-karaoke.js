import getYouTubeVideoSnippet from "../../lib/getYoutubeSnippet";
import { supabase } from "../../lib/initSupabase";
import { authorizeApi } from "../../lib/auth";

export default async function postKaraoke(req, res) {
    if (!authorizeApi(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Only POST requests allowed' });
    }

    try {
        let { url, karaoke } = req.body;
        
        let { data: record, error: fetchError } = await supabase
            .from("karaoke_video")
            .select("video_url,id")
            .eq("video_url", url).limit(1).single();

        if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 is "The result contains 0 rows"
             throw fetchError;
        }

        if (!record) {
            let { publishedAt, title, thumbnails } = await getYouTubeVideoSnippet(url);
            const { data, error: insertError } = await supabase
                .from("karaoke_video")
                .upsert({
                    video_title: title,
                    video_url: url,
                    membership: false,
                    thumbnail: thumbnails.high.url,
                    published_at: publishedAt
                })
                .select()
                .single();
            
            if (insertError) throw insertError;
            record = data;
        }

        let lists = karaoke.split(/\n/);
        for (const list of lists) {
            if (!list.trim()) continue; // Skip empty lines
            
            const parts = list.split(/;/);
            if (parts.length < 2) continue; // Skip invalid format
            
            const time = parts[0];
            const title = parts.slice(1).join(';'); // Rejoin in case title has semicolons

            let insertRecord = {
                song_title: title,
                timestamp: time,
                video_id: record.id
            };

            // Check existence
            let { data: song, error: checkError } = await supabase
                .from("karaoke_song")
                .select("id")
                .eq("song_title", title)
                .eq("timestamp", time)
                .eq("video_id", record.id);
            
            if (checkError) {
                console.error("Error checking song existence:", checkError);
                continue; 
            }

            if (song && song.length > 0) continue;

            const { error: songInsertError } = await supabase
                .from("karaoke_song")
                .insert(insertRecord);
            
            if (songInsertError) {
                 console.error("Error inserting song:", songInsertError);
            }
        }

        const { error: webhookError } = await supabase.from("webhook_table").insert({ video_id: record.id });
        if (webhookError) console.error("Error inserting to webhook table:", webhookError);

        return res.status(200).json(record);

    } catch (error) {
        console.error("Error in postKaraoke:", error);
        return res.status(500).json({ error: error.message });
    }
}