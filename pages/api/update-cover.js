import axios from "axios";
import { supabase } from "../../lib/initSupabase";
import { authorizeApi } from "../../lib/auth";

export default async function UpdateCover(req, res) {
    if (!authorizeApi(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Only POST requests allowed' });
    }

    const playlistId = 'PL-65lNPQcx_CZ_JCxF3sODkAV2XiBH3ML';
    const apiKey = process.env.GOOGLE_API_KEY;

    try {
        const response = await axios.get(
            `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&key=${apiKey}`
        );
        
        const { data } = response;
        const items = data.items || [];
        const results = [];

        for (const dat of items) {
            try {
                const { data: rec, error } = await supabase.from('sing_video').insert({
                    title: dat.snippet.title,
                    video_id: dat.snippet.resourceId.videoId,
                    published_at: dat.snippet.publishedAt
                }).select();

                if (error) {
                    console.error('Error inserting cover:', error);
                    results.push({ id: dat.snippet.resourceId.videoId, status: 'error', error });
                } else {
                    results.push({ id: dat.snippet.resourceId.videoId, status: 'success', rec });
                }

            } catch (e) {
                console.error('Exception inserting cover:', e);
                 results.push({ id: dat.snippet.resourceId.videoId, status: 'exception', error: e.message });
            }
        }
        
        return res.status(200).json({ message: 'Update process completed', results });

    } catch (e) {
        console.error('Global error in UpdateCover:', e);
        return res.status(500).json({ error: e.message });
    }
}