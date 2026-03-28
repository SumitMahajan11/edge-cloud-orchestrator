FROM node:18-alpine

WORKDIR /app

# Copy aggregator script
COPY aggregator.js /app/aggregator.js

# Set environment
ENV NODE_ENV=production
ENV TASK_TYPE=data-aggregation

CMD ["node", "/app/aggregator.js"]
