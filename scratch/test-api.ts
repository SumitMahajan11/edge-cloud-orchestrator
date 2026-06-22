async function run() {
  console.log("Checking login on port 3091...");
  try {
    const res = await fetch("http://localhost:3091/v2/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@demo-org.com",
        password: "Admin123!"
      }),
      signal: AbortSignal.timeout(5000)
    });
    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Response:", data);
  } catch (err) {
    console.error("Error connecting to 3091:", err);
  }
}
run();
