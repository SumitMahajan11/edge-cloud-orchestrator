import Redis from "ioredis";

async function run() {
  const redis = new Redis("redis://localhost:6380");
  try {
    const keys = await redis.keys("*");
    console.log("Redis keys count:", keys.length);
    console.log("Redis keys sample:", keys.slice(0, 10));
  } catch (err) {
    console.error("Error connecting to Redis:", err);
  } finally {
    redis.disconnect();
  }
}
run();
