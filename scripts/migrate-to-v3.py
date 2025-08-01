import os
import json

PROFILES_DIR = os.path.join('profiles')

def migrate_data():
    """
    A one-time script to migrate performance data from a flat file structure
    (e.g., `profiles/GROUP_ID.json`) to a versioned directory structure
    (e.g., `profiles/GROUP_ID/1.0.0.json`).
    """
    print('Starting migration of performance data to versioned format...')
    print(f'Scanning directory: {PROFILES_DIR}')

    try:
        entries = os.scandir(PROFILES_DIR)

        files_processed = 0
        for entry in entries:
            # We only care about the old flat JSON files
            # If it's a directory, we assume it's already migrated
            if entry.is_file() and entry.name.endswith('.json'):
                group_id = os.path.splitext(entry.name)[0]
                old_file_path = entry.path

                print(f'Processing old file for group: {group_id}')

                try:
                    # Read the old JSON file content.
                    with open(old_file_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)

                    # Create the new directory structure: profiles/GROUP_ID/
                    new_group_dir = os.path.join(PROFILES_DIR, group_id)
                    os.makedirs(new_group_dir, exist_ok=True)

                    # Remove the `game_version` key if it exists
                    if 'game_version' in data:
                        del data['game_version']

                    # Define the new file path, defaulting all existing data to version "1.0.0"
                    new_file_path = os.path.join(new_group_dir, '1.0.0.json')

                    # Write the modified data to the new file with indentation
                    with open(new_file_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=2)
                    print(f'  -> Created new file: {new_file_path}')

                    # Delete the old flat file
                    os.remove(old_file_path)
                    print(f'  -> Deleted old file: {old_file_path}')
                    files_processed += 1

                except (json.JSONDecodeError, IOError) as e:
                    print(f'  -> Error processing file {old_file_path}: {e}')
                    continue

        if files_processed == 0:
            print('No files found to migrate. The directory structure may already be up to date.')
        else:
            print(f'\n Migration completed successfully! Processed {files_processed} files.')

    except FileNotFoundError:
        print(f"Error: The directory '{PROFILES_DIR}' was not found.")
        print('Please make sure you have cloned the data repositories')
        exit(1)
    except Exception as e:
        print(f'An unexpected error occurred during migration: {e}')
        exit(1)

if __name__ == '__main__':
    migrate_data()