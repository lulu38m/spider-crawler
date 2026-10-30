# Spider Crawler in a container: the app plus the link fetcher, on port 8080.
#
#   docker run --rm -p 8080:8080 ghcr.io/lulu38m/spider-crawler
#   open http://localhost:8080

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
LABEL org.opencontainers.image.title="Spider Crawler" \
      org.opencontainers.image.description="A literal web crawler: drop a document, watch a spider read it, get the gist." \
      org.opencontainers.image.source="https://github.com/lulu38m/spider-crawler" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production SPIDER_NO_OPEN=1
COPY --from=build /app/package.json ./
COPY --from=build /app/bin ./bin
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
RUN find dist -name '*.map' -delete
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/ping >/dev/null || exit 1
CMD ["node", "bin/spider-crawler.mjs", "--host", "0.0.0.0", "--port", "8080", "--no-open"]
