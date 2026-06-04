import sys
import re
import os

def fix_floating_promises(findings_file):
    with open(findings_file, 'r', encoding='utf-16') as f:
        lines = f.readlines()
    
    # Group by file
    files_to_fix = {}
    for line in lines:
        line = line.strip()
        if not line: continue
        parts = line.split(':')
        if len(parts) < 2: continue
        filepath = ':'.join(parts[:-1])
        line_num = int(parts[-1])
        if filepath not in files_to_fix:
            files_to_fix[filepath] = []
        files_to_fix[filepath].append(line_num)
    
    for filepath, line_nums in files_to_fix.items():
        if not os.path.exists(filepath):
            print(f"File not found: {filepath}")
            continue
            
        print(f"Fixing {filepath}...")
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.readlines()
            
        # Sort line numbers descending to avoid shifting if I add characters?
        # Actually adding 'void ' in front of a line doesn't change subsequent line numbers.
        for ln in sorted(line_nums, reverse=True):
            idx = ln - 1
            if idx >= len(content): continue
            
            line_content = content[idx]
            # Match the first non-whitespace character
            match = re.search(r'^(\s*)(\w.*)$', line_content)
            if match:
                whitespace = match.group(1)
                code = match.group(2)
                # Avoid adding void if already there
                if not code.startswith('void ') and not code.startswith('await ') and not code.startswith('return '):
                    content[idx] = f"{whitespace}void {code}"
                    print(f"  Added void to line {ln}")
            else:
                print(f"  Could not match line {ln}: {line_content.strip()}")
                
        with open(filepath, 'w', encoding='utf-8') as f:
            f.writelines(content)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        fix_floating_promises(sys.argv[1])
    else:
        fix_floating_promises('floating_promises.txt')
