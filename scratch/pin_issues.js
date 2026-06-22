const repoOwner = 'SumitMahajan11';
const repoName = 'edge-cloud-orchestrator';
const token = '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';

async function graphqlCall(query, variables = {}) {
  const url = 'https://api.github.com/graphql';
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'node-fetch'
    },
    body: JSON.stringify({ query, variables })
  };
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GraphQL call failed (${res.status}): ${text}`);
  }
  const result = await res.json();
  if (result.errors) {
    throw new Error(`GraphQL Errors: ${JSON.stringify(result.errors)}`);
  }
  return result.data;
}

async function main() {
  try {
    const issueNumbers = [12, 13, 14];
    console.log(`Fetching node IDs for issues ${issueNumbers.join(', ')}...`);
    
    const query = `
      query GetIssueNodeIds($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          issue12: issue(number: 12) { id title }
          issue13: issue(number: 13) { id title }
          issue14: issue(number: 14) { id title }
        }
      }
    `;
    
    const data = await graphqlCall(query, { owner: repoOwner, name: repoName });
    const issueNodeIds = [
      data.repository.issue12,
      data.repository.issue13,
      data.repository.issue14
    ];
    
    console.log('Found issue node IDs:');
    issueNodeIds.forEach(i => console.log(`- ${i.title}: ${i.id}`));
    
    console.log('Pinning issues...');
    const mutation = `
      mutation PinIssue($issueId: ID!) {
        pinIssue(input: { issueId: $issueId }) {
          issue {
            number
            title
          }
        }
      }
    `;
    
    for (const issue of issueNodeIds) {
      console.log(`Pinning: ${issue.title}...`);
      const pinResult = await graphqlCall(mutation, { issueId: issue.id });
      console.log(`Successfully pinned issue #${pinResult.pinIssue.issue.number}: ${pinResult.pinIssue.issue.title}`);
    }
    
    console.log('\nAll top 3 issues successfully pinned!');
  } catch (error) {
    console.error('Error pinning issues:', error);
    process.exit(1);
  }
}

main();
