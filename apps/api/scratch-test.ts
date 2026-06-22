import axios from 'axios';

async function run() {
  try {
    console.log('Logging in...');
    const loginRes = await axios.post('http://localhost:3090/v2/auth/login', {
      email: 'admin@demo-org.com',
      password: 'Admin123!'
    });
    const token = loginRes.data.accessToken;
    console.log('Login successful! Token:', token ? 'Got token' : 'No token');

    console.log('Fetching /v2/tasks...');
    try {
      const tasksRes = await axios.get('http://localhost:3090/v2/tasks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('Tasks fetched successfully:', tasksRes.data);
    } catch (e: any) {
      console.error('Failed to fetch /v2/tasks:', e.response?.status, e.response?.data || e.message);
    }

    console.log('Fetching /v2/nodes...');
    try {
      const nodesRes = await axios.get('http://localhost:3090/v2/nodes', {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('Nodes fetched successfully:', nodesRes.data);
    } catch (e: any) {
      console.error('Failed to fetch /v2/nodes:', e.response?.status, e.response?.data || e.message);
    }
  } catch (e: any) {
    console.error('Test script failed:', e.response?.status, e.response?.data || e.message);
  }
}

run();
