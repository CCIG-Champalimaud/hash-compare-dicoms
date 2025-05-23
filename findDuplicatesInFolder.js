/**
 * @fileoverview Finds duplicate DICOM files in a folder by hashing pixel data.
 * Usage: node findDuplicatesInFolder.js <folder> [-f <outputfile>]
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const dicomParser = require('dicom-parser')
const cliProgress = require('cli-progress')

// Parse CLI arguments for folder and flags
let outputFile = null
let folder = null

for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '-f' && process.argv[i + 1]) {
        outputFile = process.argv[i + 1]
        i++
    } else if (!folder && !process.argv[i].startsWith('-')) {
        folder = path.resolve(process.argv[i])
    }
}

if (!folder) {
    console.error('Usage: node findDuplicatesInFolder.js <folder> [-f <outputfile>]')
    process.exit(1)
}

const progressBar = new cliProgress.SingleBar({
    format: 'Processing [{bar}] {percentage}% | {value}/{total} files',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
})

function hashPixelData(pixelData) {
    return crypto.createHash('sha256').update(pixelData).digest('hex')
}

function processDicomFile(filePath) {
    try {
        const dicomData = fs.readFileSync(filePath)
        const dataSet = dicomParser.parseDicom(dicomData)
        const pixelDataElement = dataSet.elements.x7fe00010
        if (!pixelDataElement) return null
        const pixelData = new Uint8Array(dicomData.buffer, pixelDataElement.dataOffset, pixelDataElement.length)
        return hashPixelData(pixelData)
    } catch {
        return null
    }
}

async function isDicomFile(filePath) {
    try {
        const buffer = Buffer.alloc(132)
        const fileHandle = await fs.promises.open(filePath, 'r')
        await fileHandle.read(buffer, 0, 132, 0)
        await fileHandle.close()
        return buffer.toString('utf8', 128, 132) === 'DICM'
    } catch {
        return false
    }
}

async function getDicomFilesRecursively(directory) {
    let dicomFiles = []
    try {
        await fs.promises.access(directory)
        const items = await fs.promises.readdir(directory)
        await Promise.all(items.map(async item => {
            const fullPath = path.join(directory, item)
            const stat = await fs.promises.stat(fullPath)
            if (stat.isDirectory()) {
                const nestedFiles = await getDicomFilesRecursively(fullPath)
                dicomFiles.push(...nestedFiles)
            } else {
                const isDicom = await isDicomFile(fullPath)
                if (isDicom) dicomFiles.push(fullPath)
            }
        }))
    } catch {}
    return dicomFiles
}

// Add this helper function for concurrency limiting
async function asyncPool(poolLimit, array, iteratorFn) {
    const ret = []
    const executing = []
    for (const item of array) {
        const p = Promise.resolve().then(() => iteratorFn(item))
        ret.push(p)
        if (poolLimit <= array.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1))
            executing.push(e)
            if (executing.length >= poolLimit) {
                await Promise.race(executing)
            }
        }
    }
    return Promise.all(ret)
}

async function findDuplicates(folder) {
    const files = await getDicomFilesRecursively(folder)
    const hashes = {}
    const concurrency = 8 // Set concurrency limit
    progressBar.start(files.length, 0)

    // Use asyncPool instead of p-limit
    let processed = 0
    const results = await asyncPool(concurrency, files, async (file) => {
        const hash = processDicomFile(file)
        processed++
        progressBar.update(processed)
        return { file, hash }
    })
    progressBar.stop()

    results.forEach(({ file, hash }) => {
        if (hash) {
            if (!hashes[hash]) hashes[hash] = []
            hashes[hash].push(file)
        }
    })

    // Collect only hashes with more than one file (duplicates)
    const duplicates = Object.entries(hashes)
        .filter(([_, fileList]) => fileList.length > 1)

    if (duplicates.length === 0) {
        console.log('No duplicates found.')
        return
    }

    if(!outputFile){
        console.log('\nDuplicate DICOM file groups (by pixel data hash):')
        console.log('---------------------------------------------------')
    }
    let totalDuplicates = 0
    const output = []
    duplicates.forEach(([hash, fileList], idx) => {
        const group = []
        
        if(!outputFile) console.log(`duplicate ${idx + 1}:`)
        
        fileList.forEach(file => {
            if(!outputFile) console.log(`- ${file}`)
            group.push(file)
        })
        output.push(group)
        totalDuplicates += fileList.length - 1
        if(!outputFile) console.log('')
    })

    if(!outputFile) console.log('---------------------------------------------------')
    console.log(`Total duplicate files (excluding originals): ${totalDuplicates}`)
    const endTime = Date.now()
    console.log(`Time taken: ${(endTime - startTime) / 1000} seconds`)

    // Save to file if requested
    if (outputFile) {
        try {
            fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf8')
            console.log(`Duplicate groups saved to ${outputFile}`)
        } catch (err) {
            console.error(`Failed to write duplicates to file: ${err.message}`)
        }
    }
}

console.log(`Starting duplicate DICOM file search in folder: ${folder}`)
const startTime = Date.now()
findDuplicates(folder).catch(error => console.error('Error:', error))
