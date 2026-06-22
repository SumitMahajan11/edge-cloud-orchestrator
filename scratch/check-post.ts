import jwt from 'jsonwebtoken';
import axios from 'axios';

async function run() {
  const token = jwt.sign(
    {
      id: "a3878c91-74c9-4917-a4e1-b1c2c620d955",
      email: "admin@demo-org.com",
      role: "ADMIN",
      tenantId: "2c919f7a-6966-4da7-9ce0-91309494f9cf",
      aud: "edge-cloud-clients",
      iss: "edge-cloud-orchestrator",
    },
    "load_test_secret_at_least_32_chars_long",
  );

  try {
    const res = await axios.post("http://127.0.0.1:3090/v2/nodes", {
      name: "LatNode-0",
      location: "New York, US",
      ipAddress: "127.0.0.1",
      port: 3000,
      region: "us-east-1",
      cpuCores: 4,
      memoryGB: 8,
      storageGB: 100
    }, {
      headers: { Authorization: "Bearer " + token }
    });
    console.log(res.status, res.data);
  } catch (err: any) {
    console.error("Error creating node:", err.response?.status, JSON.stringify(err.response?.data, null, 2));
  }
}

run();
