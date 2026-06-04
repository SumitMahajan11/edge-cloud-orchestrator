const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '../apps/api/src/routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts') && !f.includes('test') && !f.includes('spec'));

console.log(`Scanning ${files.length} route files...\n`);

for (const file of files) {
  const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
  
  // Find all fastify route declarations: fastify.get, fastify.post, fastify.put, fastify.patch, fastify.delete
  const regex = /fastify\.(get|post|put|patch|delete)\(\s*(['"][^'"]+['"])/g;
  const matches = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push({
      method: match[1],
      url: match[2],
      index: match.index,
    });
  }
  
  const suspicious = [];
  
  for (let i = 0; i < matches.length; i++) {
    const route = matches[i];
    const nextRouteIndex = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const routeBlock = content.substring(route.index, nextRouteIndex);
    
    // Find where the handler starts
    const handlerIndex = routeBlock.search(/(async\s*)?(\([^)]*\)|[a-zA-Z0-9_]+)\s*=>/);
    if (handlerIndex === -1) continue;
    
    const optionsBlock = routeBlock.substring(0, handlerIndex);
    const handlerBlock = routeBlock.substring(handlerIndex);
    
    const hasSchema = optionsBlock.includes('schema:');
    
    let hasBodySchema = false;
    let hasParamsSchema = false;
    let hasQuerySchema = false;
    
    let bodyIsZod = false;
    let paramsIsZod = false;
    let queryIsZod = false;
    
    if (hasSchema) {
      // Find schema block inside optionsBlock
      const schemaStartIndex = optionsBlock.indexOf('schema:');
      // Simple brace matching to extract the schema object
      let bracesCount = 0;
      let schemaBlock = "";
      for (let j = schemaStartIndex; j < optionsBlock.length; j++) {
        const char = optionsBlock[j];
        if (char === '{') bracesCount++;
        else if (char === '}') {
          bracesCount--;
          if (bracesCount === 0) {
            schemaBlock = optionsBlock.substring(schemaStartIndex, j + 1);
            break;
          }
        }
      }
      
      if (!schemaBlock) {
        schemaBlock = optionsBlock.substring(schemaStartIndex);
      }
      
      hasBodySchema = schemaBlock.includes('body:');
      hasParamsSchema = schemaBlock.includes('params:');
      hasQuerySchema = schemaBlock.includes('querystring:') || schemaBlock.includes('query:');
      
      bodyIsZod = schemaBlock.includes('body: zodToFastifySchema') || schemaBlock.includes('body: v1NodeContracts') || schemaBlock.includes('body: v1Contracts') || schemaBlock.includes('body: WeightsSchema') || schemaBlock.includes('body: PolicySchema') || schemaBlock.includes('body: ThresholdsSchema');
      paramsIsZod = schemaBlock.includes('params: zodToFastifySchema') || schemaBlock.includes('params: idParamSchema');
      queryIsZod = schemaBlock.includes('querystring: zodToFastifySchema') || schemaBlock.includes('querystring: v1Contracts') || schemaBlock.includes('querystring: v1NodeContracts');
    }
    
    const usesBody = handlerBlock.includes('request.body') || handlerBlock.includes('req.body') || handlerBlock.includes('request.raw.body');
    const usesParams = handlerBlock.includes('request.params') || handlerBlock.includes('req.params');
    const usesQuery = handlerBlock.includes('request.query') || handlerBlock.includes('req.query');
    
    const issues = [];
    if (usesBody && !hasBodySchema) issues.push('uses body without schema');
    if (usesBody && hasBodySchema && !bodyIsZod) issues.push('uses body with raw JSON schema instead of Zod');
    
    if (usesParams && !hasParamsSchema) issues.push('uses params without schema');
    if (usesParams && hasParamsSchema && !paramsIsZod) issues.push('uses params with raw JSON schema instead of Zod');
    
    if (usesQuery && !hasQuerySchema) issues.push('uses query without schema');
    if (usesQuery && hasQuerySchema && !queryIsZod) issues.push('uses query with raw JSON schema instead of Zod');
    
    if (issues.length > 0) {
      suspicious.push({
        method: route.method.toUpperCase(),
        url: route.url,
        issues
      });
    }
  }
  
  if (suspicious.length > 0) {
    console.log(`File: ${file}`);
    suspicious.forEach(e => {
      console.log(`  - [${e.method}] ${e.url}`);
      e.issues.forEach(issue => console.log(`      * ${issue}`));
    });
  }
}
