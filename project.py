import os
import shutil

# Configuration for each repository
REPO_CONFIGS = {
    "djangoadmin": {
        "target_dirs": ["src", "config"],
        "extra_files": ["requirements.txt", "setup.py", "pyproject.toml", "manage.py"],
        "file_patterns": [".env.", ".txt", ".py"]
    },
    "game1": {
        "target_dirs": ["src", "assets"],
        "extra_files": ["package.json", "README.md"],
        "file_patterns": [".env.", ".js", ".json"]
    },
    "front": {
        "target_dirs": ["src", "public"],
        "extra_files": ["package.json", "tsconfig.json"],
        "file_patterns": [".env.", ".js", ".jsx", ".ts", ".tsx", ".json"]
    },
    "infra": {
        "target_dirs": ["terraform", "scripts"],
        "extra_files": ["README.md"],
        "file_patterns": [".tf", ".sh", ".yaml", ".yml"]
    }
}

# Common excluded file extensions
EXCLUDED_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
    '.webp', '.tiff', '.raw', '.exe', '.dll', '.so', '.zip',
    '.tar', '.gz', '.7z', '.mp3', '.mp4', '.wav', '.ogg',
    '.mov', '.avi', '.mkv', '.pdf', '.doc', '.docx', '.xls',
    '.xlsx', '.ppt', '.pptx', '.csv', '.log'
}

# Common excluded directories
EXCLUDED_DIRS = {
    ".next", ".vscode", "node_modules", "venv", ".git",
    "__pycache__", "tests", "test", "__tests__", "migrations",
    "staticfiles", "static", "dist", "build", "coverage",
    ".idea", ".cache", "tmp", "temp", "logs", "bin", "obj"
}

# Common excluded file patterns (for test files)
EXCLUDED_FILE_PATTERNS = {
    "test_", "_test", ".spec.", ".test.", "spec.", "tests."
}

# Output directory
OUTPUT_PATH = "./project"

def is_excluded_file(filename):
    """Check if file should be excluded based on extension or test patterns"""
    # Check file extension
    if os.path.splitext(filename)[1].lower() in EXCLUDED_EXTENSIONS:
        return True

    # Check if it's a test file
    filename_lower = filename.lower()
    return any(pattern.lower() in filename_lower for pattern in EXCLUDED_FILE_PATTERNS)

def is_excluded_path(path):
    """Check if path contains any excluded directory"""
    parts = path.split(os.sep)
    return any(excluded_dir in parts for excluded_dir in EXCLUDED_DIRS)

def copy_files(base_dir, current_dir, repo_name):
    """
    Copy all files from target directories, renaming if necessary to avoid conflicts
    """
    for root, dirs, files in os.walk(current_dir):
        # Skip excluded directories
        if is_excluded_path(root):
            continue

        # Exclude unwanted directories from further traversal
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]

        for file in files:
            if is_excluded_file(file):
                continue

            source_file = os.path.join(root, file)

            # Get relative path from the target directory
            rel_path = os.path.relpath(root, base_dir)
            dir_parts = rel_path.split(os.sep)
            dir_name = '_'.join(dir_parts) if rel_path != '.' else ''

            # Define target filename with repository prefix
            if dir_name:
                name, ext = os.path.splitext(file)
                target_file = f"{repo_name}_{name}_{dir_name}{ext}"
            else:
                target_file = f"{repo_name}_{file}"

            target_path = os.path.join(OUTPUT_PATH, target_file)

            # Copy the file if it doesn't exist with the new name
            if not os.path.exists(target_path):
                shutil.copy2(source_file, target_path)

def copy_repo_files(repo_name, config):
    """Copy files from a specific repository"""
    repo_path = os.path.join(os.getcwd(), repo_name)
    if not os.path.exists(repo_path):
        print(f"Repository {repo_name} not found, skipping...")
        return

    print(f"Processing repository: {repo_name}")
    
    # Copy files from target directories
    for directory in config["target_dirs"]:
        dir_path = os.path.join(repo_path, directory)
        if os.path.exists(dir_path):
            copy_files(dir_path, dir_path, repo_name)
    
    # Copy extra files from repo root
    for file in os.listdir(repo_path):
        source_file = os.path.join(repo_path, file)
        if os.path.isfile(source_file):
            if (file in config["extra_files"] or 
                any(file.endswith(pattern) or file.startswith(pattern) 
                for pattern in config["file_patterns"])):
                
                target_file = os.path.join(OUTPUT_PATH, f"{repo_name}_{file}")
                if not os.path.exists(target_file):
                    shutil.copy2(source_file, target_file)

def main():
    # Clean or create output directory
    if os.path.exists(OUTPUT_PATH):
        shutil.rmtree(OUTPUT_PATH)
    os.makedirs(OUTPUT_PATH)

    # Process each repository
    for repo_name, config in REPO_CONFIGS.items():
        copy_repo_files(repo_name, config)

    print("All files successfully copied to 'project' folder!")

if __name__ == "__main__":
    main()