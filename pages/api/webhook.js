
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

export default async function  webhook(req, res){ 
    if (req.method !== 'POST') {
        res.status(405).send({ message: 'Only POST requests allowed' })
        return
    }
    const { record } = req.body;
    console.log(req)
    
    // Craft a message to send to Discord
    const message = {
      embeds: [
        {
          color: 0x7289da,
          title: `New update youtube video https://youtube.com/${record.video_url} ${record.video_title}`,
          thumbnail: {url: `${record.thumbnail}`}
        },
      ],
    };
    try {
      // Send the message to Discord using the incoming webhook URL
      fetch( DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: message,
      });
      
    } catch (error) {
      console.log(error)
    }

}