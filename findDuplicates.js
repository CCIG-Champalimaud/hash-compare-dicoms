const fs = require('fs')
const fsPromises = require('fs/promises')
const path = require('path')
const cliProgress = require('cli-progress')
const os = require('os')
const { open } = require('lmdb')
const crypto = require('crypto')
const dicomParser = require('dicom-parser')

const validExtensions = ['.dcm', '.dicom']

// path to the database
const dbPath = path.resolve(__dirname, 'dicom_db')

// remove existing database if it exists
if (fs.existsSync(dbPath)) {
  fs.rmSync(dbPath, { recursive: true, force: true })
}

// create the database directory
const db = open({
  path: dbPath,
  compression: true
})


let comunicate = false
let outputFile = null
let folders = []
const errors = []
let deepMode = false

for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]

    if (arg === '-f' && process.argv[i + 1]) {
        outputFile = process.argv[i + 1]
        i++

    } else if (arg === '-c') {
        communicate = true

    } else if (arg === '-d') {
        deepMode = true

    } else if (!arg.startsWith('-')) {
        folders.push(path.resolve(arg))
    }
}


if (folders.length === 0) {
    console.error('Usage: node findDuplicatesInFolder.js <folder1> [folder2 ...] [-f <outputfile>] [-c] [-ch]')
    process.exit(1)
}


let startTime = Date.now()


// START =======================================
;(async () => {

    // Remove nested folders to avoid processing subfolders multiple times
    folders = removeNestedFolders(folders)

    console.log('processing folders:')
    folders.forEach(f => console.log(' -', f))

    await scanAndIndexFiles(folders)

    

})().catch(err => {
    console.error('Error:', err)

}).finally(() => {
    // close the database connection
    db.close()
    console.log(`Time taken: ${(Date.now() - startTime) / 1000} seconds`)
})










/**
 * removes nested folders from the list, keeping only the outermost ones
 * e.g. if you have /a/b/c and /a/b, it will keep only /a/b
 * this is useful to avoid processing the same folder multiple times
 * it sorts the folders by length to ensure that shorter paths are checked first
 * and then checks if the current folder is a subfolder of any of the already added folders
 * it returns a new array with the outermost folders only
 * @param {string[]} folders - array of folder paths
 * @returns {string[]} - array of outermost folder paths
 */
function removeNestedFolders(folders) {
    const sorted = folders.map(f => path.resolve(f)).sort((a, b) => a.length - b.length)
    const result = []

    for (const folder of sorted) {
        const isSubfolder = result.some(parent => folder.startsWith(parent + path.sep))
        if (!isSubfolder) {
            result.push(folder)
        }
    }

    return result
}







/**
 * Scan folders recursively, apply filtering rules, and store valid file entries in LMDB
 */


const numCPUs = os.cpus().length
const CONCURRENCY = Math.max(2, numCPUs - 1) // leave 1 core free

async function scanAndIndexFiles(folders) {
    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.rect)

    let totalFiles = 0
    let dicomCount = 0
    const pool = []
    
    for (const folder of folders) {
        for await (const filePath of walk(folder)) {
            totalFiles++

            if (totalFiles === 1) bar.start(500, 1)
            if (totalFiles === 500) bar.setTotal(1000)
            if (totalFiles === 1000) bar.setTotal(5000)
            if (totalFiles === 5000) bar.setTotal(10000)
            if (totalFiles === 10000) bar.setTotal(100000)
            if (totalFiles === 100000) bar.setTotal(1000000)
            if (totalFiles % 1000000 === 0 && totalFiles >= 1000000) bar.setTotal(totalFiles + 1000000)
            
            bar.update(totalFiles)

            // Add file processing to the pool
            const p = (async () => {
                try {
                    const fileName = path.basename(filePath)

                    if (!deepMode) {
                        const ext = path.extname(fileName).toLowerCase()
                        if (
                            fileName.startsWith('.') ||
                            (ext && ext !== '.dcm' && ext !== '.dicom')
                        ) {
                            return
                        }
                    }

                    const dicomInfo = await processDicom(filePath)
                    if (!dicomInfo) return

                    dicomCount++

                    const record = {
                        fileName,
                        ...dicomInfo
                    }

                    await db.put(filePath, record)

                } catch (err) {
                    errors.push({ filePath, message: err.message })
                    if (errors.length < 5) {
                        console.warn(`Erro ao processar ${filePath}: ${err.message}`)
                    }
                }
            })()
            pool.push(p)

            // If pool is full, wait for one to finish
            if (pool.length >= CONCURRENCY) {
                await Promise.race(pool).catch(() => {})
                pool.shift() // Remove the oldest promise to keep pool size bounded
            }
        }
    }

    // Wait for all remaining tasks
    await Promise.allSettled(pool)

    bar.setTotal(totalFiles)
    bar.stop()

    if (errors.length > 0) {
        const errorLogPath = path.resolve(__dirname, 'scan-errors.log')
        fs.writeFileSync(errorLogPath, errors.map(e => `${e.filePath} :: ${e.message}`).join('\n'))
        console.log(`Erros registados em: ${errorLogPath}`)
    }

    console.log(`Total de ficheiros verificados: ${totalFiles}`)
    console.log(`Total de DICOMs válidos: ${dicomCount}`)
    console.log(`Total de erros: ${errors.length}`)


}









/**
 * Async generator that walks through all files in a directory and its subdirectories
 */
async function* walk(dir) {
    let entries
    try {
        entries = await fsPromises.readdir(dir, { withFileTypes: true })
    } catch (err) {
        errors.push({ filePath: dir, message: err.message })
        return
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        // Ignora dotfiles/dotfolders
        if (entry.name.startsWith('.')) continue

        try {
            if (entry.isDirectory()) {
                yield* walk(fullPath)
            } else if (entry.isFile()) {
                yield fullPath
            }
        } catch (err) {
            errors.push({ filePath: fullPath, message: err.message })
            continue
        }
    }
}









async function processDicom(filePath) {
    try {
        let stats
        try {
            stats = await fsPromises.stat(filePath)
            if (stats.size > 1_000_000_000) return null
        } catch {
            return null // no stats or file too large
        }

        const buffer = await fsPromises.readFile(filePath)
        
        if (!Buffer.isBuffer(buffer) || buffer.length < 128) return null
        
        const dataSet = dicomParser.parseDicom(buffer)

        const get = tag => {
            try {
                return dataSet.string(tag) || null
            } catch {
                return null
            }
        }

        // Extrair PixelData como byte array
        let hash = ''
        if (dataSet.elements.x7fe00010) {
            const pixelDataElement = dataSet.elements.x7fe00010
            const pixelData = buffer.slice(pixelDataElement.dataOffset, pixelDataElement.dataOffset + pixelDataElement.length)

            hash = crypto.createHash('sha1').update(pixelData).digest('hex')
        } else {
            // fallback: hash do ficheiro inteiro
            hash = crypto.createHash('sha1').update(buffer).digest('hex')
        }

        return {
            hash,
            patientId: get('x00100020'),
            studyInstanceUid: get('x0020000d'),
            seriesInstanceUid: get('x0020000e'),
            sopInstanceUid: get('x00080018'),
            sopClassUid: get('x00080016'),
            modality: get('x00080060')
        }

    } catch (err) {
        // ficheiro não é DICOM ou parsing falhou
        return null
    }
}