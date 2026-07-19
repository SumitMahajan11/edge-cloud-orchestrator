FROM openresty/openresty:alpine

# Install dependencies (curl, jq, openssl, libcap)
RUN apk add --no-cache curl jq openssl libcap

# Create symlink for nginx binary to ensure path compatibility
RUN ln -sf /usr/local/openresty/nginx/sbin/nginx /usr/local/bin/nginx

# Copy custom configuration and Lua scripts
COPY apps/api-gateway/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf
COPY apps/api-gateway/lua /etc/nginx/lua

# Create SSL and log directories, set up permissions for non-root user (nobody)
RUN mkdir -p /etc/nginx/ssl /usr/local/openresty/nginx/logs && \
    touch /var/run/nginx.pid && \
    chown -R nobody:nobody /var/run/nginx.pid /etc/nginx/ssl /usr/local/openresty/nginx

# Grant Nginx capability to bind to privileged ports (80/443) as non-root
RUN setcap 'cap_net_bind_service=+ep' /usr/local/openresty/nginx/sbin/nginx

# Copy entrypoint script
COPY apps/api-gateway/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nobody

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]
