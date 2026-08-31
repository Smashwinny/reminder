FROM node:22-alpine
RUN addgroup -S reminder && adduser -S reminder -G reminder && mkdir /data && chown reminder:reminder /data
WORKDIR /app
COPY --chown=reminder:reminder server.js auth-store.js migrate-legacy.js ./
USER reminder
ENV PORT=8787 DATA_DIR=/data NODE_ENV=production
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server.js"]
