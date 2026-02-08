
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

export default async function webhook(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Only POST requests allowed' });
    }

    const { record } = req.body;

    if (!record || !record.video_url || !record.video_title) {
        return res.status(400).json({ message: 'Invalid payload: record is missing or incomplete' });
    }

    if (!DISCORD_WEBHOOK_URL) {
         console.error('DISCORD_WEBHOOK_URL is not defined');
         return res.status(500).json({ error: 'Server configuration error' });
    }

    // Craft a message to send to Discord
    const message = {
        embeds: [
            {
                color: 0x7289da,
                title: `New update youtube video`,
                description: `[${record.video_title}](https://youtube.com/${record.video_url})`, // Improved formatting
                thumbnail: { url: record.thumbnail || '' }
            },
        ],
    };

    try {
        // Send the message to Discord using the incoming webhook URL
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(message), // Ensure body is stringified
        });

        if (!response.ok) {
             throw new Error(`Discord API responded with ${response.status}: ${response.statusText}`);
        }

        return res.status(200).json({ message: 'Webhook sent successfully' });

    } catch (error) {
        console.error('Error in webhook:', error);
        return res.status(500).json({ error: error.message });
    }
}