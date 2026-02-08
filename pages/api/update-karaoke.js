import getYouTubeVideoSnippet from "../../lib/getYoutubeSnippet";
import { supabase } from "../../lib/initSupabase";
import { authorizeApi } from "../../lib/auth";

export default async function UpdateKaraoke(req, res) {
    if (!authorizeApi(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Only POST requests allowed' });
    }

    try {
        let { data: record, error } = await supabase
            .from("karaoke_video")
            .select("id, video_url");

        if (error) throw error;

        const results = [];

        // WARNING: This iterates over ALL videos. Might timeout with large datasets.
        // Consider batching or using a queue in the future.
        for (const rec of record) {
            try {
                let { publishedAt } = await getYouTubeVideoSnippet(rec.video_url);
                
                const { error: upsertError } = await supabase
                    .from("karaoke_video")
                    .upsert({
                        ...rec,
                        published_at: publishedAt
                    });

                if (upsertError) {
                    console.error(`Error updating video ${rec.video_url}:`, upsertError);
                    results.push({ id: rec.id, status: 'error', error: upsertError });
                } else {
                    results.push({ id: rec.id, status: 'updated' });
                }

            } catch (innerError) {
                 console.error(`Exception updating video ${rec.video_url}:`, innerError);
                 results.push({ id: rec.id, status: 'exception', error: innerError.message });
            }
        }

        return res.status(200).json({ message: "Update completed", results });

    } catch (error) {
        console.error('Global error in UpdateKaraoke:', error);
        return res.status(500).json({ error: error.message });
    }
}