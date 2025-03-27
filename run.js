
/**
 * @fileoverview This script compares DICOM files in two folders by generating and comparing SHA-256 hashes of their pixel data.
 * It uses the `dicom-parser` library to parse DICOM files and extract pixel data, and the `cli-progress` library to display a progress bar.
 * The script takes two folder paths as command-line arguments and logs any matching DICOM files found in both folders, along with their patient IDs.
 * 
 * Usage: node run.js <folder1> <folder2>
 * 
 * @requires fs
 * @requires path
 * @requires crypto
 * @requires dicom-parser
 * @requires cli-progress
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const dicomParser = require('dicom-parser')
const cliProgress = require('cli-progress')

// Get folder paths from CLI arguments
if (process.argv.length < 4) {
    console.error('Usage: node run.js <folder1> <folder2> - Compare DICOM files in two folders')
    process.exit(1)
}

const folder1 = path.resolve(process.argv[2])
const folder2 = path.resolve(process.argv[3])

/**
 * Creates a new progress bar instance using the cliProgress library.
 * The progress bar displays the processing status of files with a custom format.
 * 
 * @constant {cliProgress.SingleBar} progressBar - The progress bar instance.
 * @property {string} format - The format of the progress bar display.
 * @property {string} barCompleteChar - The character used to represent completed progress.
 * @property {string} barIncompleteChar - The character used to represent incomplete progress.
 * @property {boolean} hideCursor - Whether to hide the cursor while the progress bar is displayed.
 */
const progressBar = new cliProgress.SingleBar({
    format: 'Processing [{bar}] {percentage}% | {value}/{total} files',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
})

/**
 * Generates a SHA-256 hash for the given pixel data.
 *
 * @param {Buffer | string} pixelData - The pixel data to hash. It can be a Buffer or a string.
 * @returns {string} The SHA-256 hash of the pixel data in hexadecimal format.
 */
function hashPixelData(pixelData) {
    return crypto.createHash('sha256').update(pixelData).digest('hex')
}


/**
 * Extracts the patient ID from a DICOM file.
 *
 * @param {string} filePath - The path to the DICOM file.
 * @returns {string|null} The patient ID if successfully extracted, otherwise null.
 */
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


/**
 * Processes a DICOM file to extract pixel data and generate a hash.
 *
 * @param {string} filePath - The path to the DICOM file to be processed.
 * @returns {string|null} The hash of the pixel data, or null if there is no pixel data or an error occurs.
 */
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


/**
 * Checks if a file is a valid DICOM file by reading its header.
 *
 * @param {string} filePath - The path to the file to check.
 * @returns {Promise<boolean>} A promise that resolves to true if the file is a DICOM file, otherwise false.
 */
async function isDicomFile(filePath) {
    try {
        const buffer = Buffer.alloc(132) // Allocate a buffer to read the first 132 bytes
        const fileHandle = await fs.promises.open(filePath, 'r')
        await fileHandle.read(buffer, 0, 132, 0) // Read the first 132 bytes
        await fileHandle.close()

        // Check if the "DICM" magic word is present at byte offset 128
        return buffer.toString('utf8', 128, 132) === 'DICM'
    } catch (error) {
        console.error(`Error checking if file is DICOM: ${filePath}`, error.message)
        return false
    }
}


/**
 * Recursively retrieves all DICOM files from a given directory.
 *
 * @param {string} directory - The directory to search for DICOM files.
 * @returns {Promise<string[]>} A promise that resolves to an array of file paths to DICOM files.
 * @throws Will log an error message if the directory cannot be accessed or read.
 */
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
                dicomFiles.push(...nestedFiles) // Use spread operator to add nested files
            } else {
                const isDicom = await isDicomFile(fullPath)
                if (isDicom) {
                    dicomFiles.push(fullPath) // Add the file if it is a valid DICOM file
                }
            }
        }))
    } catch (error) {
        console.error('Unable to read folder at', directory, error.message)
    }
    
    return dicomFiles
}


/**
 * Asynchronously retrieves DICOM file hashes from a specified folder.
 *
 * @param {string} folder - The path to the folder containing DICOM files.
 * @returns {Promise<Object>} A promise that resolves to an object where the keys are hashes and the values are arrays of file paths.
 */
async function getDicomHashes(folder) {
    const files = await getDicomFilesRecursively(folder)
    
    const hashes = {}

    console.log(`Scanning ${folder}...`)
    progressBar.start(files.length, 0)

    for (const [index, file] of files.entries()) {
        const hash = await processDicomFile(file)
        if (hash) {
            if (!hashes[hash]) hashes[hash] = []
            hashes[hash].push(file)
        }
        progressBar.update(index + 1)
    }

    progressBar.stop()

    return hashes
}

/**
 * Compares DICOM file hashes between two folders and logs matches.
 * 
 * This function retrieves DICOM file hashes from two specified folders,
 * compares them, and logs any matches found along with the corresponding
 * patient IDs.
 * 
 * @async
 * @function compareFolders
 * @returns {Promise<void>} A promise that resolves when the comparison is complete.
 */
async function compareFolders() {
    const hashes1 = await getDicomHashes(folder1)
    const hashes2 = await getDicomHashes(folder2)

    console.log('\nComparing files...\n')
    console.log('---------------------------------------------------')

    let matchFound = false

    for (const hash of Object.keys(hashes1)) {
        const filesInFolder1 = hashes1[hash]
        const filesInFolder2 = hashes2[hash] || [] // Get matching files in folder 2 or an empty array

        for (const file of filesInFolder1) {
            const patientId1 = await getPatientIdFromDicom(file)
            console.log(`🔍 ${file} (PatientID: ${patientId1})`)

            if (filesInFolder2.length > 0) {
                matchFound = true
                console.log('  Matches:')
                for (const matchFile of filesInFolder2) {
                    const patientId2 = await getPatientIdFromDicom(matchFile)
                    console.log(`    ✅ ${matchFile} (PatientID: ${patientId2})`)
                }
            } else {
                console.log(`    ❌ No matches found`)
            }

            console.log('---------------------------------------------------')
        }
    }
}

compareFolders().catch(error => console.error('Error comparing folders:', error))