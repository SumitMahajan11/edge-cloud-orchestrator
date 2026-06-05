import os
import re

def fix_prisma_any(directory):
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.ts') or file.endswith('.tsx'):
                if any(x in root for x in ['node_modules', 'test', 'spec', 'mock']):
                    continue
                if '.gen.' in file:
                    continue
                
                path = os.path.join(root, file)
                with open(path, 'r', encoding='utf-8') as f:
                    try:
                        content = f.read()
                    except UnicodeDecodeError:
                        continue
                
                # Replace .then((r: any) => r.count) with .then((r: { count: number }) => r.count)
                new_content = re.sub(r'\.then\s*\(\s*\(\s*(\w+)\s*:\s*any\s*\)\s*=>\s*\1\.count\s*\)', r'.then((\1: { count: number }) => \1.count)', content)
                
                # Replace catch (err: any) with catch (err) - already done but just in case
                new_content = re.sub(r'catch\s*\(([^)]+):\s*any\)', r'catch (\1)', new_content)
                
                if new_content != content:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Fixed {path}")

if __name__ == "__main__":
    fix_prisma_any('apps/api/src')
