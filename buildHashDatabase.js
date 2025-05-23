const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const axios = require('axios')
const { Client } = require('pg') // PostgreSQL
const { MongoClient } = require('mongodb') // MongoDB
const cliProgress = require('cli-progress')
const dicomParser = require('dicom-parser')

let axiosInstance = null
let isTesting = false
let execErrors = null

let databaseBatchWriteSize = 1000 //save records in batabase in batches

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
    //format: 'Processing [{bar}] {percentage}% | {value}/{total} instances',
    format: '{name} [{bar}] {percentage}%',// | {value}/{total} images',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    stopOnComplete: true,
    // forceRedraw: true,
    // clearOnComplete: false,
    renderThrottle: 100
}, cliProgress.Presets.shades_grey)


// const multibar = new cliProgress.MultiBar({
//     clearOnComplete: false,
//     hideCursor: true,
//     format: ' {bar} | {value}/{total}',
// }, cliProgress.Presets.shades_grey);


const run = async () => {

    const config = await getConfig()
    if (!config) {
        console.error('unable to parse config.json')
        process.exit(1)
    }
   
    const { orthanc, database } = config

    // Validate configuration
    if (!orthanc.url) {
        console.error('Invalid Orthanc configuration in config.json')
        process.exit(1)
    }

    if (!isTesting && (!database.type || !database.connectionString) ) {
        console.error('Invalid database configuration in config.json')
        process.exit(1)
    }

    //if(isTesting) {
        console.log('------- Config -------')
        console.log( orthanc, database)
        console.log('----------------------')
    //}
    
  
    
        // Create Axios instance for Orthanc
    axiosInstance = createAxiosInstance(orthanc)

    // Test Orthanc connection
    if(!await testOrthancConnection()) {
        console.log('no orthanc detected, consider starting orthanc or using run.js script which is intended for physical folders')
        process.exit(1)
    }

    // Test database connection
    if(!await testDatabaseConnection(database) && !isTesting) {
        console.log('Database connection is required to run this script in production mode. Add testing flag "-t" to print the results without saving to database')
        process.exit(1)
    }
    
    //clear array of errors
    execErrors = []
    let totalImagesHashed = 0

    try {
        totalImagesHashed = await buildHashDatabase(database)  
    } catch (error) {
        console.error('Error building hash database:', error.message)
    }

    if(execErrors && execErrors.length) {
        console.log('\n--------- Hashing failed for the following instances: ---------------\n')
        execErrors.forEach(e => {
            console.log(`${e.orthancId}\t- ${e.instanceId}\t- ${e.error}`)
        })
    }
    
    console.log(`\n--------- Hashing complete on ${totalImagesHashed} images ---------------`)
    process.exit(0)
}//run










async function getConfig(){
    // Load configuration from config.json
    const configPath = path.resolve(__dirname, 'config.json')
    if (!fs.existsSync(configPath)) {
        console.error('Configuration file "config.json" not found.')
        return null
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))    
        return parsed

    } catch (error) {
        return null
    }
    
}







//test orthanc connection
async function testOrthancConnection() {
    if(!axiosInstance) return false

    try {
        // Use the /system endpoint to test the connection
        const response = await axiosInstance.get('/system')
        if (response.status === 200) {
            console.log('Successfully connected to Orthanc.')
            return true
        } else {
            console.error('Unexpected response from Orthanc:', response.status)
            return false
        }
    } catch (error) {
        console.error('Failed to connect to Orthanc:', error.message)
        return false
    }
}








const createAxiosInstance = (orthancSettings) => {
    const { url, username, password } = orthancSettings
    const auth = username && password ? { auth: { username, password } } : {}
    return axios.create({ baseURL: url, ...auth })
}







// Test database connection
async function testDatabaseConnection(db) {
    let testPassed = false
    
    if (db.type === 'postgres') {
        const client = new Client({ connectionString: db.connectionString })
        try {
            await client.connect()
            testPassed = true
            console.log('Successfully connected to PostgreSQL database.')
        } catch (error) {
            console.error('Failed to connect to PostgreSQL database:', error.message)
            
            console.error('Ensure that the database is running and the connection string is correct and includes valid credentials.')
            console.error('For PostgreSQL, verify the username and password in the connection string, e.g., "postgres://username:password@host:port/database".\n')
            
            console.error('To check or add a user in PostgreSQL, you can use the following commands:')
            console.error('\t1. Connect to PostgreSQL: psql -U postgres')
            console.error('\t2. Create a user: CREATE USER your_username WITH PASSWORD \'your_password\';')
            console.error('\t3. Grant privileges: GRANT ALL PRIVILEGES ON DATABASE your_database TO your_username;')

        } finally {
            await client.end()
        }
        
    } else if (db.type === 'mongodb') {
        const client = new MongoClient(db.connectionString)
        try {
            await client.connect()
            testPassed = true
            console.log('Successfully connected to MongoDB database.')
        } catch (error) {
            console.error('Failed to connect to MongoDB database:', error.message)
            console.log('Ensure that the database is running and the connection string is correct and includes valid credentials.')
            console.log('For MongoDB, verify the connection string format, e.g., "mongodb://username:password@host:port/your_database".\n')

            const regex = /mongodb:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/
            const match = db.connectionString.match(regex)

            if (match) {
                const [, username, password, host, port] = match
                
                console.log('To check or add a user in MongoDB, you can use the following commands:')
                console.log('\t1. Connect to MongoDB: mongo')
                console.log(`\t2. Switch to your database: use your_database;`)
                console.log(`\t3. authenticate: db.auth("${username}", "${password}");`)
                console.log(`\t4. using last 2 steps with "admin" database and auth with admin credentials, you can create a user with: db.createUser({ user: "${username}", pwd: "${password}", roles: [{ role: "readWrite", db: "your_database" }] });`)
            }
           
        } finally {
            await client.close()
        }
    } else {
        console.error('Unsupported database type in configuration. Use "postgres" or "mongodb".')
    }
    return testPassed
}








// Function to generate SHA-256 hash for pixel data
function hashPixelData(pixelData) {
    return crypto.createHash('sha256').update(pixelData).digest('hex')
}






// Function to fetch all instances from Orthanc
async function fetchOrthancInstances() {
    try {
        const response = await axiosInstance.get('/instances')
        return response.data; // List of instance IDs
    } catch (error) {
        console.error('Error fetching instances from Orthanc:', error.message)
        return null
    }
}







// Function to fetch DICOM file from Orthanc
async function fetchDicomFile(orthancId) {
    try {
        const response = await axiosInstance.get(`/instances/${orthancId}/file`, { responseType: 'arraybuffer' })
        return Buffer.from(response.data)
    } catch (error) {
        execErrors.push({ orthancId, instanceId: ' '.padStart(70, ' '), error: 'Error fetching DICOM file', errorDetail: error.message })
        return null
    }
}







// Function to process a DICOM file and extract metadata and hash
async function processDicomFile(dicomData, orthancId) {
    try {
        
        const dataSet = await dicomParser.parseDicom(dicomData)
       
        const pixelDataElement = dataSet.elements.x7fe00010
        const instanceId = dataSet.string('x00080018') || 'Unknown'
        const patientId = dataSet.string('x00100020') || 'Unknown'
        const studyId = dataSet.string('x00200010') || 'Unknown'

        if (!pixelDataElement) {
            execErrors.push({ orthancId, instanceId: instanceId.padStart(70, ' '), error: 'No pixel data found', detail:'' })
            return null
        }

        const pixelData = new Uint8Array(dicomData.buffer, pixelDataElement.dataOffset, pixelDataElement.length)
        const hash = hashPixelData(pixelData)

        return { orthancId, instanceId, hash }
    
    } catch (error) {    
        execErrors.push({ orthancId, instanceId: instanceId.padStart(70, ' '), error: 'failed to parse dicom file', detail:error.message })
        return null
    }
}





const storeInDatabase = async (databaseConfig, data,  progressBar, progressName) => {
   
    if(databaseConfig.type === 'postgres') {
        return await storeInPostgres(databaseConfig.connectionString, data, progressBar, progressName)
    
    }else if(databaseConfig.type === 'mongodb') {
        return await storeInMongoDB(databaseConfig.connectionString, data, progressBar, progressName)
    }
}





// Function to store data in PostgreSQL
async function storeInPostgres(connectionString, data, progressBar, progressName) {
    const client = new Client({ connectionString });
    await client.connect();

    await client.query(`
        CREATE TABLE IF NOT EXISTS dicom_hashes (
            hash TEXT PRIMARY KEY,
            patient_id TEXT,
            study_id TEXT
        )
    `);

    const batchSize = 1000; // Number of records per batch
    for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);

        // Construct a single INSERT query for the batch
        const values = batch
            .map(({ hash, patientId, studyId }, index) => `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`)
            .join(', ');

        const query = `
            INSERT INTO dicom_hashes (hash, patient_id, study_id)
            VALUES ${values}
            ON CONFLICT (hash) DO NOTHING
        `;

        const params = batch.flatMap(({ hash, patientId, studyId }) => [hash, patientId, studyId]);

        await client.query(query, params);
        console.log(`Inserted batch ${i / batchSize + 1}`);
    }

    await client.end();
}








// Function to store data in MongoDB
async function storeInMongoDB(connectionString, data, progressBar, progressName) {
   
    const client = new MongoClient(connectionString)
    await client.connect()

    const db = client.db('cliniti')
    const collection = db.collection('dicom-hashes')

    const batchSize = 100 // Number of records per batch
    const totalBatches = Math.ceil(data.length / batchSize)

    //console.log(`Starting to write ${data.length} documents to MongoDB in ${totalBatches} batches...`)

    progressBar.start(totalBatches, 0)

    for (let i = 0; i < totalBatches; i++) {
        const batch = data.slice(i * batchSize, (i + 1) * batchSize)

        const bulkOps = batch.map(({ orthancId, instanceId, hash }) => ({
            updateOne: {
                filter: { instanceId }, // Filter by instanceId
                update: { $set: { orthancId, instanceId, hash } }, // Update or insert the document
                upsert: true, // Insert if it doesn't exist
            },
        }))

        try {
            await collection.bulkWrite(bulkOps)

            // Update the progress bar
            progressBar.update((i + 1), { name: progressName })
           
        } catch (error) {
            console.error(`Error writing batch ${i + 1}:`, error.message)
        }
    }

    // Ensure the progress bar reaches 100% at the end
    progressBar.update(totalBatches, { name: progressName })
    progressBar.stop()

    //console.log('MongoDB bulk write operation completed.')
    await client.close()
}








const processOrthancInstances = async (orthancIds, bProgress, progressName) => {
    const results = []

    for (const [i, orthancId] of Object.entries(orthancIds)) {
        
        try {
            const dicomData = await fetchDicomFile(orthancId)
        
            if(dicomData) {
                results.push( await processDicomFile(dicomData, orthancId) )
            }

        } catch (error) {
            execErrors.push({ orthancId, instanceId: instanceId.padStart(70, ' '), error: 'Error processing DICOM file', detail: error.message })
        }
        
        bProgress.update(+i+1, { name: progressName})
    }
    
    return results.filter(result => result !== null) // Filter out null results)
}





// Main function
async function buildHashDatabase(databaseConfig) {
    
    const orthancIds = await fetchOrthancInstances()
    
    if (!orthancIds || !orthancIds.length ) {
        console.log('No instances found in Orthanc.')
        return
    }
    
    const totalBatches = databaseBatchWriteSize === 0 ? 2**32 - 1 : Math.ceil(orthancIds.length / databaseBatchWriteSize)
    
    
    console.log(`\nStart hashing ${orthancIds.length} images in ${totalBatches} batches \n`)
    
    for(let i = 0; i < totalBatches; i++) {
       
        const batch = orthancIds.slice(i * databaseBatchWriteSize, (i + 1) * databaseBatchWriteSize)
        
        progressBar.start(batch.length, 0) //multibar.create(batch.length, 0)    
        
        const data = await processOrthancInstances(batch, progressBar, `Processing images (${+i+1}/${totalBatches})`.padStart(22,' '))
        
        progressBar.update(batch.length, {name: `Batch ${+i+1}/${totalBatches}`})
        progressBar.stop()

        if(!isTesting) {
            await storeInDatabase(databaseConfig, data, progressBar, `Updating database (${+i+1}/${totalBatches})`.padStart(22,' '))
        }
    }

    return orthancIds.length
}







// Check for the -t flag in the command line arguments
if (process.argv.includes('-t')) {
    isTesting = true
}

//execute the main function
run()