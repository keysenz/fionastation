export const authorizeApi = (req) => {
  const secret = process.env.API_ROUTE_SECRET;
  if (!secret) return false; // If no secret is set, fail safe (or maybe we should log a warning?)
  
  const authHeader = req.headers['x-api-secret'];
  return authHeader === secret;
};
