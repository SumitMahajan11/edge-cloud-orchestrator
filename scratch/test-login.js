async function test() {
  console.log('1. Attempting login...');
  const loginRes = await fetch('http://localhost:3090/v2/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@demo-org.com',
      password: 'Admin123!'
    })
  });

  console.log('Login Status:', loginRes.status);
  const loginData = await loginRes.json();
  console.log('Login Response:', JSON.stringify(loginData, null, 2));

  if (!loginRes.ok) {
    console.error('Login failed!');
    return;
  }

  const token = loginData.token;
  console.log('\n2. Attempting to fetch protected route /v2/nodes with token...');
  const nodesRes = await fetch('http://localhost:3090/v2/nodes', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  console.log('Nodes Status:', nodesRes.status);
  const nodesData = await nodesRes.json();
  console.log('Nodes Response:', JSON.stringify(nodesData, null, 2));
}

test().catch(err => console.error('Error:', err));
