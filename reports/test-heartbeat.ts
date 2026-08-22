import axios from "axios";
import jwt from "jsonwebtoken";

async function main() {
  const token = jwt.sign(
    {
      id: "load-test-user",
      email: "load@test.com",
      role: "ADMIN",
      tenantId: "test-tenant",
      aud: "edge-cloud-clients",
      iss: "edge-cloud-orchestrator",
    },
    "load_test_secret_at_least_32_chars_long",
  );

  const API_URL = "http://127.0.0.1:3000/v2";

  try {
    console.log("Registering a test node...");
    const registerResponse = await axios.post(
      `${API_URL}/nodes`,
      {
        name: `TestNode-${Date.now()}`,
        location: "London, UK",
        ipAddress: "127.0.0.1",
        port: 5000,
        region: "us-east-1",
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 100,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const node = registerResponse.data;
    console.log("Node registered successfully:", node);

    console.log("Sending heartbeat...");
    const heartbeatResponse = await axios.post(
      `${API_URL}/nodes/${node.id}/heartbeat`,
      {
        cpuUsage: 10,
        memoryUsage: 20,
        tasksRunning: 0,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    console.log("Heartbeat response:", heartbeatResponse.data);

    console.log("Querying the node status...");
    const queryResponse = await axios.get(`${API_URL}/nodes/${node.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("Node query response:", queryResponse.data);
  } catch (error: any) {
    if (error.response) {
      console.error("Error status:", error.response.status);
      console.error(
        "Error body:",
        JSON.stringify(error.response.data, null, 2),
      );
    } else {
      console.error("Error message:", error.message);
    }
  }
}

void main();
