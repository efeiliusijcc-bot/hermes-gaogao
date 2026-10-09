# Build context contains only compiled recall files and the retrieval dependency tree.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY --chown=node:node dist-server/server/ /app/dist-server/server/
USER node
CMD ["node", "dist-server/server/source-recall-main.js"]
