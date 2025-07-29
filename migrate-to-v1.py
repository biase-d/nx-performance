import os
import json
import subprocess
import shutil

OLD_DATA_DIR = 'data'
NEW_PROFILES_DIR = 'profiles'
NEW_BRANCH_NAME = 'v1'

def run_command(command):
    result = subprocess.run(command, capture_output=True, text=True, shell=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {command}\nError: {result.stderr.strip()}")
    return result.stdout.strip()

def check_git_clean():
    status = run_command('git status --porcelain')
    if status:
        raise RuntimeError('Your repository has uncommitted changes. Please commit or stash them before running the migration.')

def migrate():
    print("Starting migration...")

    if not os.path.isdir(OLD_DATA_DIR):
        raise FileNotFoundError(f"The source directory '{OLD_DATA_DIR}' was not found. Cannot proceed.")
    check_git_clean()

    if os.path.exists(NEW_PROFILES_DIR):
        print(f"Directory '{NEW_PROFILES_DIR}' already exists. Removing it to ensure a clean slate.")
        shutil.rmtree(NEW_PROFILES_DIR)
    print(f"Creating new directory: {NEW_PROFILES_DIR}")
    os.makedirs(NEW_PROFILES_DIR)

    migrated_count = 0
    file_list = [f for f in os.listdir(OLD_DATA_DIR) if f.endswith('.json')]
    print(f"Found {len(file_list)} profiles to migrate from '{OLD_DATA_DIR}'.")

    for filename in file_list:
        group_id = os.path.splitext(filename)[0]
        old_path = os.path.join(OLD_DATA_DIR, filename)
        new_path = os.path.join(NEW_PROFILES_DIR, filename)

        try:
            with open(old_path, 'r', encoding='utf-8') as f:
                profile_data = json.load(f)
        except json.JSONDecodeError:
            print(f"  - WARNING: Skipping invalid JSON file: {filename}")
            continue

        with open(new_path, 'w', encoding='utf-8') as f:
            json.dump(profile_data, f, indent=2)
        
        migrated_count += 1
    
    print(f"Successfully migrated {migrated_count} profiles to '{NEW_PROFILES_DIR}'.")

    print(f"Removing old data directory: '{OLD_DATA_DIR}'...")
    shutil.rmtree(OLD_DATA_DIR)

    print("\nPerforming Git operations...")
    print(f"Creating and switching to new branch: '{NEW_BRANCH_NAME}'...")
    try:
        run_command(f'git checkout -b {NEW_BRANCH_NAME}')
    except RuntimeError as e:
        if "already exists" in str(e):
            print(f"Branch '{NEW_BRANCH_NAME}' already exists. Checking it out.")
            run_command(f'git checkout {NEW_BRANCH_NAME}')
        else:
            raise e

    print("Staging changes...")
    run_command(f'git add {NEW_PROFILES_DIR}')
    run_command(f'git rm -r --cached {OLD_DATA_DIR}')
    run_command('git add -u') # Stage the deletion

    print("Committing changes...")
    run_command(f'git commit -m "feat(data): Migrate from data/ to profiles/ for v1"')

if __name__ == '__main__':
    try:
        migrate()
        print("\n Success: Migration complete!")
        print(f"A new branch '{NEW_BRANCH_NAME}' has been created with all the changes.")
        print(f"You can now push this branch to your remote repository: git push origin {NEW_BRANCH_NAME}")
    except (FileNotFoundError, RuntimeError) as e:
        print(f"\n Error: An error occurred during migration: {e}")
        exit(1)
