const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const { once } = require('events')
const readline = require('readline')
const crypto = require('crypto')
const dicomParser = require('dicom-parser')

const readdir = promisify(fs.readdir)



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
 * Recursively walks through a directory and appends file paths to a temp file.
 * @param {string} dir - The directory to walk.
 * @param {fs.WriteStream} writeStream - The write stream to append paths to.
 * @param {object} counter - Object with a 'count' property to track files checked.
 * @returns {Promise<void>}
 */
async function writeFilePathsToTemp(dir, deepMode, writeStream, counter) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.warn(`Skipping inaccessible folder: ${dir}`)
      return
    } else {
      throw err
    }
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await writeFilePathsToTemp(fullPath, deepMode, writeStream, counter)
      
    } else if (entry.isFile()) {
       
        // if deepMode is false, check extension
        if (!deepMode) {
            const ext = path.extname(fullPath).toLowerCase()
            const baseName = path.basename(fullPath)
            //also ignore files starting with a dot
            const validExts = ['', '.dcm', '.dicom']
            if (!validExts.includes(ext) || baseName.startsWith('.')) {
                continue
            }
        }

        counter.count++ // increment for every file checked
        console.log(`${fullPath}`)

        try {
          writeStream.write(fullPath + '\n')
        } catch (err) {
          console.warn(`Failed to write path: ${fullPath} — ${err.message}`)
        }
    }
  }
}

/**
 * Creates a temp file in current folder and writes all file paths from the given directory.
 * @param {string} dirPath - The directory to scan.
 * @param {boolean} deepMode
 * @param {string} tempFilePath
 * @param {object} counter - Object with a 'count' property to track files checked.
 * @returns {null} 
 */
async function saveAllFilePaths(dirPath, deepMode, tempFilePath, counter) {
  const writeStream = fs.createWriteStream(tempFilePath, { flags: 'a' })
  await writeFilePathsToTemp(dirPath, deepMode, writeStream, counter)
  writeStream.end()
  await once(writeStream, 'finish')
}





/**
 * Lê um ficheiro linha a linha e processa cada caminho.
 * @param {string} tempFilePath - Caminho para o ficheiro temporário com paths.
 * @param {(filePath: string, index: number, total: number) => Promise<void>} processFn
 */
async function processFilePaths(tempFilePath, processFn, progressBar = null) {
  const fileStream = fs.createReadStream(tempFilePath)

  // Primeiro passo: contar número total de linhas
  let total = 0
  for await (const _ of readline.createInterface({ input: fileStream })) {
    total++
  }

  if(progressBar){
    progressBar.start(total, 0)
  }

  // Reiniciar stream para o segundo passo
  const fileStream2 = fs.createReadStream(tempFilePath)
  const rl = readline.createInterface({
    input: fileStream2,
    crlfDelay: Infinity
  })

  let index = 0
  for await (const line of rl) {
    if (line.trim()) {
        await processFn(line, index, total)
        index++
        if(progressBar){
            progressBar.update(index)
        }
    }
  }

  if(progressBar){
    progressBar.stop()
  }
}





/**
 * Checks if a file is a DICOM file by reading its header.
 * @param {string} filePath - The path to the file to check.
 * @returns {Promise<boolean>} - Returns true if the file is a DICOM file, false otherwise. 
 */
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




/**
 * Processes a DICOM file to extract relevant data and generate a hash.
 * @param {string} filePath - The path to the DICOM file to be processed.
 * @returns {Promise<string|null>} - A promise that resolves to the hash of the relevant data, or null if no relevant data is found.
 */
async function processDicomFile(filePath, counter) {
    try {
        const dicomData = await fs.promises.readFile(filePath)
        const dataSet = dicomParser.parseDicom(dicomData)
        counter.dicoms++
        return extractRelevantData(dataSet)
    } catch (error) {
        //console.error(`Error processing ${filePath}:`, error)
        return null
    }
}




/**
 * Extracts relevant data from a DICOM dataset based on SOP Class UID and modality.
 * @param {object} dataSet - The DICOM dataset to extract data from.
 * @returns {string|null} - The hash of the relevant data, or null if no relevant data is found.
 */
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






/** 
 * Checks if the SOP Class UID corresponds to a special DICOM SOP Class.
 * This includes PDF, SR, RT Structure Set, and Waveform SOP Classes.
 * @param {string} sopClassUID - The SOP Class UID to check.
 * @returns {boolean} - Returns true if the SOP Class UID is special, false otherwise.
*/
function isSpecialSOPClass(sopClassUID) {
    return [
        '1.2.840.10008.5.1.4.1.1.104.1', // PDF
        '1.2.840.10008.5.1.4.1.1.88.',   // SR (prefix match)
        '1.2.840.10008.5.1.4.1.1.481.3', // RT Structure Set
        '1.2.840.10008.5.1.4.1.1.9.1.',  // Waveform
        //'1.2.840.10008.5.1.4.1.1.66.4'   // Segmentation (has pixelData so it's normal)
    ].some(prefix => sopClassUID.startsWith(prefix))
}





/** 
 * Handles special SOP Class UIDs by extracting relevant data and generating a hash.
 * @param {object} dataSet - The DICOM dataset to extract data from.
 * @param {string} sopClassUID - The SOP Class UID to check.
 * @returns {string|null} - The hash of the relevant data, or null if no relevant data is found.
*/
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

    // Add other handlers as needed
    return null
}




/**
 * Generates a SHA-256 hash from a buffer.
 * @param {Buffer} buffer - The buffer to hash.
 * @returns {string} - The SHA-256 hash in hexadecimal format.
 */
function hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex')
}




// Export functions for use in other modules
module.exports = { removeNestedFolders, writeFilePathsToTemp, saveAllFilePaths, processFilePaths, isDicomFile, processDicomFile }