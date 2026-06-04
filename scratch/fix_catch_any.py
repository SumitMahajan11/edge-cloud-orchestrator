import os
import re

def fix_catch_any(directory):
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
                
                new_content = re.sub(r'catch\s*\(([^)]+):\s*any\)', r'catch (\1)', content)
                
                if new_content != content:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Fixed {path}")

if __name__ == "__main__":
    fix_catch_any('apps/api/src')
    fix_catch_any('packages')
