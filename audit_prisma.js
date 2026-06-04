import fs from 'fs';
import path from 'path';

const routesDir = 'd:/Projects/Cloud1/edge-cloud-orchestrator/apps/api/src/routes';
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts'));

files.forEach(file => {
    const filePath = path.join(routesDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
        if (line.includes('prisma.') && 
            !line.includes('prismaForTenant') && 
            !line.includes('tenantPrisma') && 
            !line.includes('req.prisma') && 
            !line.includes('// admin') && 
            !line.includes('SUPER_ADMIN')) {
            console.log(`${file}:${index + 1}: ${line.trim()}`);
        }
    });
});
