import os
import json

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))

PROFILES_DIR = os.path.join(REPO_ROOT, 'profiles')
OLD_VALUE = 'Unlocked'
NEW_VALUE = 'Unstable' 

def migrate_fps_behavior():
    """
    Scans all JSON files in the profiles directory and updates the
    fps_behavior field from 'Unlocked' to a new default value.
    """
    print("Starting v2 FPS behavior data migration...")

    if not os.path.isdir(PROFILES_DIR):
        raise FileNotFoundError(f"The source directory '{PROFILES_DIR}' was not found. Cannot proceed.")
    
    updated_files_count = 0
    total_files_scanned = 0
    profile_files = [f for f in os.listdir(PROFILES_DIR) if f.endswith('.json')]

    for filename in profile_files:
        total_files_scanned += 1
        file_path = os.path.join(PROFILES_DIR, filename)
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                profile_data = json.load(f)
        except json.JSONDecodeError:
            print(f"  - WARNING: Skipping invalid JSON file: {filename}")
            continue

        changed = False
        if profile_data.get('docked', {}).get('fps_behavior') == OLD_VALUE:
            profile_data['docked']['fps_behavior'] = NEW_VALUE
            changed = True
        
        if profile_data.get('handheld', {}).get('fps_behavior') == OLD_VALUE:
            profile_data['handheld']['fps_behavior'] = NEW_VALUE
            changed = True

        if changed:
            print(f"  - Migrating: {filename}")
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(profile_data, f, indent=2)
            updated_files_count += 1

    print(f"\nScanned {total_files_scanned} total profiles.")
    print(f" Successfully migrated {updated_files_count} profiles to the v2 FPS stability format")
    if updated_files_count > 0:
        print("Please review the changes")
    else:
        print("No files required migration.")


if __name__ == '__main__':
    try:
        migrate_fps_behavior()
    except FileNotFoundError as e:
        print(f"\n An error occurred: {e}")
        exit(1)