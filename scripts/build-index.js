import fs from 'fs/promises';
import path from 'path';
import postgres from 'postgres';
import { schema } from './schema.js';

const dataRepoPath = path.resolve(process.cwd(), 'tmp/titledb_data')
const mainIndexPath = path.join(dataRepoPath, 'output/main.json')
const detailsDirPath = path.join(dataRepoPath, 'output/titleid')
const performanceRepoPath = path.resolve(process.cwd(), 'tmp/performance_data')
const performanceDataPath = path.join(performanceRepoPath, 'data')

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_BOT_TOKEN;

const owner = 'biase-d'; //todo
const repo = 'nx-performance'; //todo

function parseSize (sizeStr) {
    if (!sizeStr) return null
        const sizeMap = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }
        const [value, unit] = (sizeStr || '').split(' ')
        const parsedValue = parseFloat(value)
        if (isNaN(parsedValue)) return null
            return Math.round(parsedValue * (sizeMap[unit] || 1))
}

async function buidContributorMap() {
    if (!GITHUB_TOKEN) {
        console.warn("GITHUB_TOKEN not available. Skipping contributor attribution.");
        return new Map();
    }
    console.log(`Building contributor map from ${owner}/${repo} PR history...`);
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const contributorMap = new Map();
    const coAuthorRegex = /Co-authored-by: .+ <(?:\d+\+)?(.+?)@users\.noreply\.github\.com>/;

    try {
        const prs = await octokit.paginate(octokit.pulls.list, { owner, repo, state: 'closed', per_page: 100 });
        console.log(`Found ${prs.length} closed PRs to process`);

        for (const pr of prs) {
            if (!pr.merged_at) continue;

            const branchName = pr.head.ref;
            const titleIdMatch = branchName.match(/([A-F0-9]{16})$/);
            if (!titleIdMatch) continue;

            const titleId = titleIdMatch[1].toUpperCase();

            const { data: commits } = await octokit.pulls.listCommits({ owner, repo, pull_number: pr.number, per_page: 1 });
            if (commits.length === 0) continue;

            const commit = commits[0];
            const commitMessage = commit.commit.message;
            const primaryAuthorLogin = commit.author?.login;

            let contributor = null;
            const coAuthorMatch = commitMessage.match(coAuthorRegex);

            if (coAuthorMatch && coAuthorMatch[1]) {
                contributor = coAuthorMatch[1];
            } else if (primaryAuthorLogin && primaryAuthorLogin.toLowerCase() !== 'web-flow') {
                contributor = primaryAuthorLogin;
            }

            if (contributor) {
                contributorMap.set(titleId, contributor);
            }
        }
    } catch (apiError) {
        console.error(`Failed to build contributor map from GitHub API: ${apiError.message}`);
    }

    console.log(`-> Contributor map built with ${contributorMap.size} entries.`);
    return contributorMap;
}

async function syncDatabase() {
    console.log('Starting database synchronization process...')

    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
        console.error("ERROR: POSTGRES_URL environment variable not found.");
        process.exit(1);
    }

    const sql = postgres(connectionString, { ssl: 'require' });

    try {
        console.log("Verifying database schema...");
        const tableExistsResult = await sql`SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = ${schema.tableName});`;

        if (!tableExistsResult[0].exists) {
            console.log(`-> Table '${schema.tableName}' does not exist. Creating from scratch...`);
            for (const extQuery of schema.extensions) {
                await sql.unsafe(extQuery);
            }
            const columnDefs = schema.columns.map(c => `"${c.name}" ${c.type} ${c.constraints || ''}`).join(', ');
            await sql.unsafe(`CREATE TABLE ${schema.tableName} (${columnDefs})`);
            console.log("-> Table created. Applying indexes...");
            for (const indexQuery of schema.indexes) {
                await sql.unsafe(indexQuery);
            }
            console.log("-> Schema creation complete.");
        } else {
            console.log(`-> Table '${schema.tableName}' exists. Verifying columns...`);
            for (const extQuery of schema.extensions) {
                await sql.unsafe(extQuery);
            }
            const columnsResult = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${schema.tableName};`;
            const existingColumns = new Set(columnsResult.map(c => c.column_name));
            
            for (const column of schema.columns) {
                if (!existingColumns.has(column.name)) {
                    console.warn(`--> Column '${column.name}' is missing. Attempting to add it...`);
                    await sql.unsafe(`ALTER TABLE ${schema.tableName} ADD COLUMN "${column.name}" ${column.type} ${column.constraints || ''}`);
                    console.log(`---> Successfully added '${column.name}' column.`);
                }
            }
            console.log("-> Schema verification complete.");
        }

        const contributorMap = await buidContributorMap()
        
        console.log('Reading and merging data for titles found in nx-performance...')
        const mainIndexContent = await fs.readFile(mainIndexPath, 'utf-8')
        const mainIndex = JSON.parse(mainIndexContent)
        const performanceFiles = await fs.readdir(performanceDataPath); 
        const titleIds = performanceFiles   
            .filter(f => f.endsWith('.json'))   .map(f => f.replace('.json', ''));

        const allGamesData = []
        for (const id of titleIds) {
            const detailPath = path.join(detailsDirPath, `${id}.json`)
            try {
                const detailContent = await fs.readFile(detailPath, 'utf-8')
                const details = JSON.parse(detailContent)

                let performanceData = null
                const perfFilePath = path.join(performanceDataPath, `${id}.json`)
                try {
                    const perfContent = await fs.readFile(perfFilePath, 'utf-8')
                    performanceData = JSON.parse(perfContent)
                } catch (e) { /* Expected */ }

                allGamesData.push({
                    id,
                    names: mainIndex[id],
                    publisher: details.publisher || null,
                    release_date: details.releaseDate || null,
                    size_in_bytes: parseSize(details.size),
                    icon_url: details.iconUrl || null,
                    banner_url: details.bannerUrl || null,
                    screenshots: details.screenshots || null,
                    performance: performanceData,
                    contributor: contributorMap.get(id) || null
                })
            } catch (error) {
                if (error.code !== 'ENOENT') console.error(`Failed to process file for ID: ${id}`, error)
            }
        }
        console.log(`Successfully transformed data for ${allGamesData.length} games.`)

        const batchSize = 1000;
        console.log(`Upserting ${allGamesData.length} records in batches of ${batchSize}...`)
        for (let i = 0; i < allGamesData.length; i += batchSize) {
            const batch = allGamesData.slice(i, i + batchSize);
            process.stdout.write(`  -> Processing batch ${Math.floor(i / batchSize) + 1} / ${Math.ceil(allGamesData.length / batchSize)}... `);
            await sql`
            INSERT INTO games ${sql(batch, 'id', 'names', 'publisher', 'release_date', 'size_in_bytes', 'icon_url', 'banner_url', 'screenshots', 'performance', 'contributor')}
            ON CONFLICT (id) DO UPDATE SET
            names = EXCLUDED.names, publisher = EXCLUDED.publisher, release_date = EXCLUDED.release_date, size_in_bytes = EXCLUDED.size_in_bytes,
            icon_url = EXCLUDED.icon_url, banner_url = EXCLUDED.banner_url, screenshots = EXCLUDED.screenshots, 
            performance = EXCLUDED.performance, contributor = EXCLUDED.contributor, last_updated = NOW()
            `
            console.log('Done.');
        }
        console.log('-> Database synchronization completed successfully.')

    } catch (dbError) {
        console.error('An error occurred during the database operation:', dbError)
        process.exit(1)
    } finally {
        console.log('Closing database connection.')
        await sql.end()
    }

    console.log('\nDatabase sync process finished successfully!')
}

syncDatabase()
