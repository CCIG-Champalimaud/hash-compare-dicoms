
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const dicomParser = require('dicom-parser')
const cliProgress = require('cli-progress')

// Get folder paths from CLI arguments
if (process.argv.length < 4) {
    console.error('Usage: node run.js <folder1> <folder2>')
    process.exit(1)
}

const folder1 = path.resolve(process.argv[2])
const folder2 = path.resolve(process.argv[3])


const progressBar = new cliProgress.SingleBar({
    format: 'Processing [{bar}] {percentage}% | {value}/{total} files',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
})

function hashPixelData(pixelData) {
    return crypto.createHash('sha256').update(pixelData).digest('hex')
}


function getPatientIdFromDicom(filePath){
    try {
        const dicomData = fs.readFileSync(filePath)
        const dataSet = dicomParser.parseDicom(dicomData)
        
        return dataSet.string('x00100020')

    } catch (error) {
        console.error(`Error processing ${filePath}:`, error.message)
        return null
    }
    
}


function processDicomFile(filePath) {
    try {
        const dicomData = fs.readFileSync(filePath)
        const dataSet = dicomParser.parseDicom(dicomData)
        const pixelDataElement = dataSet.elements.x7fe00010

        if (!pixelDataElement) {
            console.log(`No pixel data in: ${filePath}`)
            return null
        }

        const pixelData = new Uint8Array(dicomData.buffer, pixelDataElement.dataOffset, pixelDataElement.length)
        return hashPixelData(pixelData)
    } catch (error) {
        console.error(`Error processing ${filePath}:`, error.message)
        return null
    }
}

function getDicomFilesRecursively(directory) {
    let dicomFiles = []
    if (!fs.existsSync(directory)) return dicomFiles

    try {
        const items = fs.readdirSync(directory)
        items.forEach(item => {
            const fullPath = path.join(directory, item)
            if (fs.statSync(fullPath).isDirectory()) {
                dicomFiles = dicomFiles.concat(getDicomFilesRecursively(fullPath))
            } else if (fullPath.toLowerCase().endsWith('.dcm')) {
                dicomFiles.push(fullPath)
            }
        })
    } catch (error) {
        console.error('unable to read folder at', directory, error.message)
    }
    
    return dicomFiles
}

function getDicomHashes(folder) {
    const files = getDicomFilesRecursively(folder)
    const hashes = {}

    console.log(`Scanning ${folder}...`)
    progressBar.start(files.length, 0)

    files.forEach((file, index) => {
        const hash = processDicomFile(file)
        if (hash) {
            if (!hashes[hash]) hashes[hash] = []
            hashes[hash].push(file)
        }
        progressBar.update(index + 1)
    })

    progressBar.stop()

    return hashes
}

function compareFolders() {
    const hashes1 = getDicomHashes(folder1)
    const hashes2 = getDicomHashes(folder2)
    let matchFound = false

    console.log('\nComparing files...\n')

    Object.keys(hashes2).forEach(hash => {
        if (hashes1[hash]) {
            matchFound = true
            console.log(`Match found for hash: ${hash}`)
            console.log('  Folder 1 files:')
            hashes1[hash].forEach(file => {
                const patientId = getPatientIdFromDicom(file)
                console.log(`    - ${file} (${patientId})`)
            })
            console.log('  Folder 2 files:')
            hashes2[hash].forEach(file => {
                const patientId = getPatientIdFromDicom(file)
                console.log(`    - ${file} (${patientId})`)
            })
            console.log('---------------------------------------------------')
        }
    })

    if (!matchFound) {
        console.log('No matches found.')
    }
}

compareFolders()