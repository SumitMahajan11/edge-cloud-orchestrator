async function test() {
  const req = new Request('http://localhost:3090/v2/nodes', {
    headers: { 'X-Test': 'Hello' }
  });

  console.log('Headers before customFetch simulation:', req.headers.get('X-Test'));

  // CustomFetch simulation
  let baseHeaders = req.headers;
  const newHeaders = new Headers(baseHeaders);
  newHeaders.set('Authorization', 'Bearer dummy-token');

  console.log('New Headers X-Test:', newHeaders.get('X-Test'));
  console.log('New Headers Authorization:', newHeaders.get('Authorization'));

  // Let's create the fetch call
  // Note: we can't inspect the sent headers of fetch easily without a server,
  // but we can check if new Request(req, { headers: newHeaders }) works.
  try {
    const newReq = new Request(req, { headers: newHeaders });
    console.log('Constructed Request X-Test:', newReq.headers.get('X-Test'));
    console.log('Constructed Request Authorization:', newReq.headers.get('Authorization'));
  } catch (err) {
    console.error('Request constructor error:', err);
  }
}

test();
