import sys
import re
import os

def fix_floating_promises(findings_file):
    if not os.path.exists(findings_file):
        print(f"Findings file not found: {findings_file}")
        return

    # Regex to parse ESLint unix format with Windows/Unix paths
    # Example: D:\path\to\file.ts:67:5: Promises must be...
    line_pattern = re.compile(r'^([A-Za-z]:\\[^:]+|/[^:]+):(\d+):(\d+):')

    # Group by file, then by line, then list of columns
    files_to_fix = {}

    lines = []
    try:
        with open(findings_file, 'r', encoding='utf-16') as f:
            lines = f.readlines()
            # If it's empty or parsed incorrectly, maybe it was utf-8
            if not lines or all(not l.strip() for l in lines):
                raise ValueError("Empty or all blank lines")
    except Exception:
        with open(findings_file, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

    for line in lines:
        line = line.strip()
        if not line:
            continue
        match = line_pattern.match(line)
        if match:
            filepath = match.group(1)
            line_num = int(match.group(2))
            col_num = int(match.group(3))
            
            if filepath not in files_to_fix:
                files_to_fix[filepath] = {}
            if line_num not in files_to_fix[filepath]:
                files_to_fix[filepath][line_num] = []
            files_to_fix[filepath][line_num].append(col_num)

    print(f"Found {len(files_to_fix)} files to fix.")

    for filepath, lines in files_to_fix.items():
        if not os.path.exists(filepath):
            print(f"File not found: {filepath}")
            continue

        print(f"Fixing {filepath}...")
        with open(filepath, 'r', encoding='utf-8') as f:
            file_content = f.readlines()

        # Sort lines descending to prevent any shifting if we modify lines (though modifying a line doesn't affect other lines)
        for ln in sorted(lines.keys(), reverse=True):
            idx = ln - 1
            if idx >= len(file_content):
                continue

            line_str = file_content[idx]
            # Get columns sorted descending to prevent column index shift within the same line
            cols = sorted(lines[ln], reverse=True)

            for col in cols:
                col_idx = col - 1
                if col_idx >= len(line_str):
                    continue

                # Safety checks:
                # 1. Do not add 'void' if the text already has 'void ', 'await ', 'return ' at that position
                substring = line_str[col_idx:]
                if substring.startswith('void ') or substring.startswith('await ') or substring.startswith('return '):
                    continue

                # 2. Do not add 'void' if it's a function declaration, export, class, etc.
                # Usually ESLint won't flag these as floating promises, but just in case:
                word_match = re.match(r'^\w+', substring)
                if word_match:
                    word = word_match.group(0)
                    if word in ['export', 'import', 'function', 'class', 'const', 'let', 'var', 'type', 'interface', 'return', 'await', 'void']:
                        print(f"  Skipping keyword '{word}' at {filepath}:{ln}:{col}")
                        continue

                # Insert 'void ' at col_idx
                line_str = line_str[:col_idx] + 'void ' + line_str[col_idx:]

            file_content[idx] = line_str

        with open(filepath, 'w', encoding='utf-8') as f:
            f.writelines(file_content)

    print("Finished fixing floating promises.")

if __name__ == "__main__":
    findings = 'current_floating_promises.txt'
    if len(sys.argv) > 1:
        findings = sys.argv[1]
    fix_floating_promises(findings)
