/**
 * @fileoverview Finds duplicate DICOM files in a folder by hashing pixel data.
 * Usage: node findDuplicatesInFolder.js <folder> [-f <outputfile>] [-c] [-ch]
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const dicomParser = require('dicom-parser')
const cliProgress = require('cli-progress')

// Parse CLI arguments for folder and flags
let outputFile = null
let folder = null
let communicate = false
let communicateHash = false

for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '-f' && process.argv[i + 1]) {
        outputFile = process.argv[i + 1]
        i++
    } else if (process.argv[i] === '-c') {
        communicate = true
    } else if (process.argv[i] === '-ch') {
        communicateHash = true
    } else if (!folder && !process.argv[i].startsWith('-')) {
        folder = path.resolve(process.argv[i])
    }
}

if (!folder) {
    console.error('Usage: node findDuplicatesInFolder.js <folder> [-f <outputfile>] [-c] [-ch]')
    process.exit(1)
}

const progressBar = (!communicate && !communicateHash) ? new cliProgress.SingleBar({
    format: 'Processing [{bar}] {percentage}% | {value}/{total} files',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
}) : null

function hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function processDicomFile(filePath) {
    try {
        const dicomData = await fs.promises.readFile(filePath)
        const dataSet = dicomParser.parseDicom(dicomData)
        return extractRelevantData(dataSet)
    } catch {
        return null
    }
}


function extractRelevantData(dataSet) {
    const sopClassUID = dataSet.string('x00080016') || ''
    const modality = dataSet.string('x00080060') || ''
    
    // Handle image-based modalities
    if (!isSpecialSOPClass(sopClassUID)) {
        const pixelDataElement = dataSet.elements.x7fe00010
        if (!pixelDataElement || pixelDataElement.length === 0) return null

        const pixelData = new Uint8Array(
            dataSet.byteArray.buffer,
            pixelDataElement.dataOffset,
            pixelDataElement.length
        )
        return hashBuffer(pixelData)
    }

    // Handle special cases
    return handleSpecialSOPClass(dataSet, sopClassUID)
}


function isSpecialSOPClass(sopClassUID) {
    return [
        '1.2.840.10008.5.1.4.1.1.104.1', // PDF
        '1.2.840.10008.5.1.4.1.1.88.',   // SR (prefix match)
        '1.2.840.10008.5.1.4.1.1.481.3', // RT Structure Set
        '1.2.840.10008.5.1.4.1.1.9.1.',  // Waveform
        //'1.2.840.10008.5.1.4.1.1.66.4'   // Segmentation (has pixelData so it's normal)
    ].some(prefix => sopClassUID.startsWith(prefix))
}


function handleSpecialSOPClass(dataSet, sopClassUID) {
    //encapsulated pdf
    if (sopClassUID === '1.2.840.10008.5.1.4.1.1.104.1') {
        const docElement = dataSet.elements.x00420011
        if (!docElement || docElement.length === 0) return null
        const buffer = new Uint8Array(
            dataSet.byteArray.buffer,
            docElement.dataOffset,
            docElement.length
        )

        return hashBuffer(buffer)
    }

    //SR 
    if(sopClassUID.startsWith('1.2.840.10008.5.1.4.1.1.88.') ){
        const contentElement = dataSet.elements.x0040a730
        if (!contentElement || contentElement.length === 0) return null
    
        const buffer = new Uint8Array(
            dataSet.byteArray.buffer,
            contentElement.dataOffset,
            contentElement.length
        )
       
        return hashBuffer(buffer)
    }
    
    // RT Structure 
    if (sopClassUID === '1.2.840.10008.5.1.4.1.1.481.3') {
        const targets = [
            'x30060020', // StructureSetROISequence
            'x30060039', // ROIContourSequence
            'x30060080'  // RTROIObservationsSequence
        ]
    
        const buffers = []
    
        for (const tag of targets) {
            const element = dataSet.elements[tag]
            if (element && element.length > 0) {
                const buffer = new Uint8Array(
                    dataSet.byteArray.buffer,
                    element.dataOffset,
                    element.length
                )
                buffers.push(...buffer)
            }
        }
    
        if (buffers.length === 0) return null
    
        return hashBuffer(new Uint8Array(buffers))
    }

    //Waveform
    if(sopClassUID.startsWith('1.2.840.10008.5.1.4.1.1.9.1.') ){
        const waveformElement = dataSet.elements.x54000100
        if (!waveformElement || waveformElement.length === 0) return null

        const buffer = new Uint8Array(
            dataSet.byteArray.buffer,
            waveformElement.dataOffset,
            waveformElement.length
        )

        return hashBuffer(buffer)
    }

    // Add other handlers like SR, Waveforms, etc. as needed
    return null
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
        for (const item of items) {
            const fullPath = path.join(directory, item)
            const stat = await fs.promises.stat(fullPath)
            if (stat.isDirectory()) {
                const nestedFiles = await getDicomFilesRecursively(fullPath)
                dicomFiles.push(...nestedFiles)
            } else {
                const isDicom = await isDicomFile(fullPath)
                if (isDicom) dicomFiles.push(fullPath)
            }
        }
    } catch {}
    return dicomFiles
}

// Add this helper function for concurrency limiting
async function asyncPool(poolLimit, array, iteratorFn) {
    const executing = []

    for (const item of array) {
        const p = Promise.resolve().then(() => iteratorFn(item))

        const e = p.then(() => {
            executing.splice(executing.indexOf(e), 1)
        })
        executing.push(e)

        if (executing.length >= poolLimit) {
            await Promise.race(executing)
        }
    }

    await Promise.all(executing)
}

async function findDuplicates(folder) {
    const files = await getDicomFilesRecursively(folder)
    const hashes = new Map()
    const concurrency = 8

    if (!communicate && !communicateHash) progressBar.start(files.length, 0)

    let processed = 0
    let totalDuplicates = 0
    const output = []

    await asyncPool(concurrency, files, async (file) => {
        const hash = await processDicomFile(file)
        processed++

        if (communicate) {
            if (hash) {
                process.stdout.write(JSON.stringify({
                    type: "hash",
                    fileName: path.basename(file),
                    fullPath: file,
                    hash,
                    progressCurrent: processed,
                    progressTotal: files.length
                }) + "\n")
            }
        } else if (communicateHash) {
            if (hash) {
                process.stdout.write(JSON.stringify({
                    type: "hash",
                    fileName: path.basename(file),
                    fullPath: file,
                    hash,
                    progressCurrent: processed,
                    progressTotal: files.length
                }) + "\n")
            }
        } else {
            progressBar.update(processed)
        }

        // Guardar hashes (exceto se comunicar só hashes)
        if (!communicateHash && hash) {
            if (!hashes.has(hash)) hashes.set(hash, [])
            hashes.get(hash).push(file)
        }
    })

    if (!communicate && !communicateHash) progressBar.stop()

    // Se só comunicar hashes, termina aqui
    if (communicateHash) return

    const duplicates = [...hashes.entries()].filter(([_, files]) => files.length > 1)

    if (duplicates.length === 0) {
        if (!communicate) {
            console.log('No duplicates found.')
        } else {
            process.stdout.write(JSON.stringify({ type: "summary", totalDuplicates: 0, timeSeconds: ((Date.now() - startTime) / 1000) }) + "\n")
        }
        return
    }

    duplicates.forEach(([hash, fileList], idx) => {
        const group = fileList.map(file => ({
            fileName: path.basename(file),
            fullPath: file
        }))
        if (!outputFile && !communicate) {
            console.log(`duplicate ${idx + 1}:`)
            fileList.forEach(file => console.log(`- ${file}`))
            console.log('')
        }
        output.push(fileList)
        totalDuplicates += fileList.length - 1

        if (communicate) {
            process.stdout.write(JSON.stringify({ type: "duplicate", group, hash }) + "\n")
        }
    })

    if (!outputFile && !communicate) {
        console.log('---------------------------------------------------')
        console.log(`Total duplicate files (excluding originals): ${totalDuplicates}`)
        console.log(`Time taken: ${(Date.now() - startTime) / 1000} seconds`)
    }

    if (communicate) {
        process.stdout.write(JSON.stringify({
            type: "summary",
            totalDuplicates,
            timeSeconds: (Date.now() - startTime) / 1000
        }) + "\n")
    }

    if (outputFile) {
        try {
            fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf8')
            if (!communicate) console.log(`Duplicate groups saved to ${outputFile}`)
        } catch (err) {
            console.error(`Failed to write duplicates to file: ${err.message}`)
        }
    }
}

if (!communicate && !communicateHash) console.log(`Starting duplicate DICOM file search in folder: ${folder}`)
const startTime = Date.now()
findDuplicates(folder).catch(error => console.error('Error:', error))
