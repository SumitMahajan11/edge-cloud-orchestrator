import sys
import re

def parse_lint_results(filepath):
    current_file = ""
    results = []
    
    target_rule = sys.argv[2] if len(sys.argv) > 2 else None
    
    with open(filepath, 'r', encoding='utf-16') as f:
        for line in f:
            line = line.rstrip()
            if not line:
                continue
            
            # File path line
            if line.startswith('D:\\') or line.startswith('apps/') or line.startswith('packages/'):
                current_file = line
                continue
            
            # Error line
            # Match line number and type
            match = re.search(r'^\s+(\d+):\d+\s+(error|warning)', line)
            if match and current_file:
                line_num = match.group(1)
                # Find rule name - it's usually the last word in the line or near the end
                parts = line.split()
                rule = parts[-1] if parts else ""
                
                if not target_rule or target_rule == rule:
                    results.append(f"{current_file}:{line_num}:{rule}")
                
    return results

if __name__ == "__main__":
    findings = parse_lint_results('lint_results.txt')
    for f in findings:
        print(f)
