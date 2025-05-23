/**
 * @fileoverview Finds duplicate DICOM files in a folder by hashing pixel data.
 * Usage: node findDuplicatesInFolder.js <folder>
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const dicomParser = require('dicom-parser')
const cliProgress = require('cli-progress')

// Get folder path from CLI arguments
if (process.argv.length < 3) {
    console.error('Usage: node findDuplicatesInFolder.js <folder>')
    process.exit(1)
}

const folder = path.resolve(process.argv[2])

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

async function findDuplicates(folder) {
    const files = await getDicomFilesRecursively(folder)
    const hashes = {}
    progressBar.start(files.length, 0)
    for (const [index, file] of files.entries()) {
        const hash = processDicomFile(file)
        if (hash) {
            if (!hashes[hash]) hashes[hash] = []
            hashes[hash].push(file)
        }
        progressBar.update(index + 1)
    }
    progressBar.stop()

    let foundDuplicates = false
    console.log('\nDuplicate DICOM files (by pixel data hash):')
    console.log('---------------------------------------------------')
    for (const [hash, fileList] of Object.entries(hashes)) {
        if (fileList.length > 1) {
            foundDuplicates = true
            console.log(`Hash: ${hash}`)
            console.log(`  Original: ${fileList[0]}`)
            for (let i = 1; i < fileList.length; i++) {
                console.log(`  Duplicate: ${fileList[i]}`)
            }
            console.log('---------------------------------------------------')
        }
    }
    if (!foundDuplicates) {
        console.log('No duplicates found.')
    }
}

findDuplicates(folder).catch(error => console.error('Error:', error))
