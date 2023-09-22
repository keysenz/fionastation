const getYouTubeVideoSnippet = async (videoId) => {
    const apiKey = process.env.GOOGLE_API_KEY;
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
  
    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
  
      if (data.items.length > 0) {
        const snippet = data.items[0].snippet;
        return snippet;
      } else {
        throw new Error('Video not found');
      }
    } catch (error) {
      console.error('Error retrieving YouTube video title:', error);
    }
  };
export default getYouTubeVideoSnippet