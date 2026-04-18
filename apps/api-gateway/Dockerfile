FROM nginx:alpine

# Copy custom configuration
COPY apps/api-gateway/nginx.conf /etc/nginx/nginx.conf

# Use a non-root user for security (nginx user in alpine)
RUN touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid /var/cache/nginx /var/log/nginx /etc/nginx/conf.d

USER nginx

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1
