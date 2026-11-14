FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/playlistName.ts ./src/playlistName.ts
# The commission routes decode with the form's own Schema and prices, so the image carries those
# files and `effect`, which has no dependencies of its own.
COPY --from=build /app/src/page/commission/inquiryPayload.ts /app/src/page/commission/inquiryContract.ts /app/src/page/commission/pricing.ts ./src/page/commission/
COPY --from=build /app/node_modules/effect ./node_modules/effect
# uid 1000 matches the bot's user, which owns the database's -shm and -wal files.
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.ts"]
