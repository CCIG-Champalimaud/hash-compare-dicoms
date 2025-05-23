const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const dicomParser = require('dicom-parser');

/**
 * Loads the configuration from config.json.
 *
 * @returns {Object} The parsed configuration object.
 * @throws Will throw an error if the configuration file is missing or invalid.
 */
function getConfig() {
    const configPath = path.resolve(__dirname, 'config.json');
    if (!fs.existsSync(configPath)) {
        console.error('Configuration file "config.json" not found.');
        process.exit(1);
    }

    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.error('Error parsing "config.json":', error.message);
        process.exit(1);
    }
}

/**
 * Generates a SHA-256 hash for the given pixel data.
 *
 * @param {Buffer} pixelData - The pixel data to hash.
 * @returns {string} The SHA-256 hash of the pixel data in hexadecimal format.
 */
function hashPixelData(pixelData) {
    return crypto.createHash('sha256').update(pixelData).digest('hex');
}

/**
 * Extracts pixel data from a DICOM file and generates its hash.
 *
 * @param {string} filePath - The path to the DICOM file.
 * @returns {Promise<string>} The SHA-256 hash of the pixel data.
 * @throws Will throw an error if the file cannot be read or parsed.
 */
async function getDicomFileHash(filePath) {
    const dicomData = fs.readFileSync(filePath);
    const dataSet = dicomParser.parseDicom(dicomData);

    const pixelDataElement = dataSet.elements.x7fe00010;
    if (!pixelDataElement) {
        throw new Error('No pixel data found in the DICOM file.');
    }

    const pixelData = new Uint8Array(dicomData.buffer, pixelDataElement.dataOffset, pixelDataElement.length);
    return hashPixelData(pixelData);
}

/**
 * Checks if a DICOM file's pixel data hash exists in the MongoDB database.
 *
 * @param {Object} databaseConfig - The database configuration object.
 * @param {string} filePath - The path to the DICOM file.
 * @returns {Promise<Object|null>} The matched record if it exists, or null otherwise.
 */
async function checkDicomFileInDatabase(databaseConfig, filePath) {
    const client = new MongoClient(databaseConfig.connectionString);
    await client.connect();

    const db = client.db(databaseConfig.databaseName || 'cliniti');
    const collection = db.collection(databaseConfig.collectionName || 'dicom-hashes');

    try {
        const hash = await getDicomFileHash(filePath);
        const result = await collection.findOne({ hash });
        return result; // Return the matched record or null
    } catch (error) {
        console.error('Error checking DICOM file in database:', error.message);
        return null;
    } finally {
        await client.close();
    }
}

// Main function to handle command-line arguments
(async () => {
    if (process.argv.length < 3) {
        console.error('Usage: node checkDicomFileInDatabase.js <dicomFilePath>');
        process.exit(1);
    }

    const filePath = path.resolve(process.argv[2]);

    // Load configuration from config.json
    const config = getConfig();
    const databaseConfig = config.database;

    if (!databaseConfig || databaseConfig.type !== 'mongodb') {
        console.error('Invalid or unsupported database configuration in "config.json".');
        process.exit(1);
    }

    try {
        const record = await checkDicomFileInDatabase(databaseConfig, filePath);
        if (record) {
            console.log(`DICOM file exists in database.`);
            console.log(`Orthanc ID: ${record.orthancId}`);
            console.log(`Instance ID: ${record.instanceId}`);
            process.exit(0);
        } else {
            console.log(`DICOM file does not exist in database.`);
            process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
})();