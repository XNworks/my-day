FROM node:22-alpine

WORKDIR /app
COPY . .

ENV PORT=8080 \
    DATA_DIR=/data

RUN mkdir -p /data && chown node:node /data
USER node

VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.js"]
