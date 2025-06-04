
const fs = require('fs-extra')
const path = require('path')
const cliProgress = require('cli-progress')
const os = require('os')


const { 
    removeNestedFolders, 
    writeFilePathsToTemp,
    saveAllFilePaths, 
    processFilePaths,
    isDicomFile,
    processDicomFile,
 } = require('./lib/fileHelper')

/**
    Usage: node findDups.js <folder1> [folder2 ...] [-f <outputfile>] [-c] [-ch]
    -f <outputfile> : Specify an output file to save results
    -c : Enable communication mode (e.g., for IPC or network communication)
    -ch : Enable communication mode with hash (e.g., for IPC or network communication with hashes)
    -d : deep scan mode (will check all files whatever the extension)
    <folder1> <folder2> ... : Folders to search for duplicates
**/

// Parse CLI arguments for folders and flags
let outputFile = null
let folders = []
let communicate = false
let communicateHash = false
let deepMode = false

for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]

    if (arg === '-f' && process.argv[i + 1]) {
        outputFile = process.argv[i + 1]
        i++

    } else if (arg === '-c') {
        communicate = true

    } else if (arg === '-ch') {
        communicateHash = true
    
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

const showProgressBar = !communicate && !communicateHash

// set up the temp file path
const tempFilePath = path.join(os.tmpdir(), `filepaths-${Date.now()}.tmp`)

//define a cleanup function to remove the temp file on exit
const cleanup = () => {
    try {
        //check if file exists before trying to delete it
        if(fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath)
        }
            
    } catch (error) {
       //no need to log if this fails, means the file was already deleted or never created
    }
}   


const progressBar = (!communicate && !communicateHash) ? new cliProgress.SingleBar({
    format: 'Processing [{bar}] {percentage}% | {value}/{total} files',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
}) : null








// START =======================================
;(async () => {
    const startTime = Date.now()

    // Remove nested folders to avoid processing subfolders multiple times
    folders = removeNestedFolders(folders)

    const counter = { count: 0, dicoms: 0 }
    for(const folderPath of folders) {
        console.log(`Processing folder: ${folderPath}`)
        await saveAllFilePaths(folderPath, deepMode, tempFilePath, counter)
    }

    //let totalDicoms = 0
    const hashes = new Map()

    await processFilePaths(tempFilePath, async (filePath, index, total) => {
        //removed because dicomParser does this check internally
        // const isDicom = await isDicomFile(filePath)
        // if(!isDicom) return

        //some dicoms will not be hashable but totalDicoms should still be incremented
        //totalDicoms++
        
        const hash = await processDicomFile(filePath, counter)

        if(!hash) {
            return
        }

        // just output the hashes for each file if communicateHash is true
        if(communicateHash ) {
            process.stdout.write(JSON.stringify({
                type: "hash",
                fileName: path.basename(filePath),
                fullPath: filePath,
                hash,
                progressCurrent: +index + 1,
                progressTotal: total
            }) + "\n")
        
        // keep hashes in memory for further processing if not in communicateHash mode
        }else{
            //first hash found
            if (!hashes.has(hash)){
                hashes.set(hash, [])
            }
            //push the file path to the hash array (if only one exists in the array, it is a unique file)
            hashes.get(hash).push(filePath)
        }
        
    }, showProgressBar ? progressBar : null)

    //exit prematurely if in communicate mode
    if(communicateHash){
        return cleanup()
    }

    const duplicates = [...hashes.entries()].filter(([_, files]) => files.length > 1)

    // no duplicates found
    if (duplicates.length === 0) {
        if (!communicate) {
            console.log('No duplicates found.')
        } else {
            process.stdout.write(JSON.stringify({ type: "summary", totalDuplicates: 0, timeSeconds: ((Date.now() - startTime) / 1000) }) + "\n")
        }
        return cleanup()
    }
    
    const output = []
    let totalDuplicates = 0

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


    // sumary and output
    if (!outputFile && !communicate) {
        console.log('---------------------------------------------------')
        console.log(`Files checked: ${counter.count}, dicoms: ${counter.dicoms}, duplicates: ${totalDuplicates}`)
        console.log(`Time taken: ${(Date.now() - startTime) / 1000} seconds`)
    }

    if (communicate) {
        process.stdout.write(JSON.stringify({
            type: "summary",
            totalFiles: counter.count,
            totalDicoms: counter.dicoms,
            totalDuplicates: totalDuplicates,
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
        console.log(`Files checked: ${counter.count}, dicoms: ${counter.dicoms}, duplicates: ${totalDuplicates}`)
        console.log(`Time taken: ${(Date.now() - startTime) / 1000} seconds`)
    }
  
    cleanup()
})()



process.on('exit', code => {
    if (code !== 0) {
        console.error(`Process exited with code ${code}`)
    }
  cleanup()
})

process.on('SIGINT', () => {
  cleanup()
  process.exit(0)
})

process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})

process.on('uncaughtException', err => {
    console.error('Uncaught Exception:', err.message)
  cleanup()
  process.exit(1)
})

process.on('unhandledRejection', err => {
    console.error('Unhandled Rejection:', err.message)
  cleanup()
  process.exit(1)
})
