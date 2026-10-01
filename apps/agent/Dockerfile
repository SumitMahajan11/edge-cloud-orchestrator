# Stage 1: Builder
FROM rust:1.85-alpine AS builder
RUN apk add --no-cache musl-dev musl-utils openssl-dev openssl-libs-static pkgconfig git

WORKDIR /app

# Copy Cargo files for dependency caching
COPY Cargo.toml Cargo.lock ./
# Create dummy files to build dependencies
RUN mkdir -p src benches && echo "fn main() {}" > src/main.rs && echo "fn main() {}" > benches/cold_start.rs
RUN cargo build --release --target x86_64-unknown-linux-musl
RUN rm -rf src/ benches/

# Copy real source and build
COPY src ./src
COPY benches ./benches
RUN touch src/main.rs
RUN cargo build --release --target x86_64-unknown-linux-musl

# Stage 2: Runner
FROM scratch AS runner
WORKDIR /

# Copy static binary from builder
COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/edge-agent /agent

# Optional: Copy CA certs if agent makes HTTPS requests
# COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

USER 1001

ENTRYPOINT ["/agent"]
