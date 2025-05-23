# 🏥 DICOM Compare

A Node.js script to **recursively scan and compare DICOM medical images** between two folders.  
It extracts the **pixel data**, hashes it, and detects duplicate or matching images.  
Uses **SHA-256 hashing** for accurate comparison.

---

## 📦 Features
✅ **Recursive folder scan** (all subdirectories included)  
✅ **Extracts pixel data** from DICOM files (`x7FE00010` tag)  
✅ **Hashes and compares** images using `SHA-256`  
✅ **CLI progress bar** for better visibility  
✅ **Reports all matching files** with their paths and PatientID's

---

## 🚀 Installation & Setup

### 1️⃣ Install Dependencies
Make sure you have **Node.js** installed, then run:

```sh
npm install
```

### 2️⃣ setup config.json
    - **run.js** does not need configuration since it only uses folders for comparison and these are args in command line. 

    - **buildHashDatabase.js** uses the config.json to connect to orthanc and a database. This can be set following these guidelines:

    ```json
    {
        "orthanc": {
            "url": "http://localhost:8042",
            "username": "admin", //leave empty if no auth is enforced
            "password": "orthanc" //leave empty if no auth is enforced
        },
        "database": {
            //if postgres is used
            "type": "postgres",
            "connectionString": "postgres://user:password@localhost:5432/database_name",
            //if mongodb is used
            "type": "mongodb",
            "connectionString": "mongodb://user:password@localhost:27017/database_name",
        }
    }
    ```


## Running the scripts
Navigate to the project folder and run in command line:

### 1️⃣ run.js
```sh
node run.js /path/to/folder1 /path/to/folder2
```
---
📊 Example Output

When you run the script, it will scan the folders, compare all DICOM files (with or without .dcm extension), and produce output like this:

```
---------------------------------------------------
🔍 /example/folder1/test.dcm (PatientID: xxxxxxxx1)
    ✅ /example/folder2/subfolder/same_as_test.dcm (PatientID: xxxxxxxx1)
    ✅ /example/folder2/another_subfolder/same_as_test_no_ext (PatientID: xxxxxxxx1)
    ✅ /example/folder2/yet_another_subfolder/same_as_test_other.ext (PatientID: xxxxxxxx1)
---------------------------------------------------
🔍 /example/folder1/test_no_match.dcm (PatientID: xxxxxxxx2)
    ❌ No matches found
---------------------------------------------------
```
---


### 2️⃣ buildHashDatabase.js
use -t flag to test first if the script works. It will output information about the connections to orthanc and database and a sample of the data that it will gather and would be saved into the database

```sh
node buildHashDatabase.js -t
```

When you are confident that the script is working remove the flag to save all images in database

```sh
node buildHashDatabase.js
```

### 3️⃣ findDuplicatesInFolder.js
To run the script directly with Node.js:

```sh
node findDuplicatesInFolder.js /path/to/folder
```
#### Optional Flags

You can use the following optional flags with `findDuplicatesInFolder.js`:

- `-f <filename>`  
    Save the list of duplicates as a JSON array to the specified file.

- `-c`  
    Enable communication-friendly output for integration with other apps. The script will output one JSON object per line:
    - Progress updates:  
        `{ "type": "progress", "current": <number>, "total": <number> }`
    - Duplicate group found:  
        `{ "type": "duplicate", "group": [<file1>, <file2>, ...] }`
    - Final summary:  
        `{ "type": "summary", "totalDuplicates": <number>, "timeSeconds": <number> }`

These flags can be combined as needed. Example:

```sh
node findDuplicatesInFolder.js /path/to/folder -f results.json -c
```
Alternatively, you can create standalone executables (no Node.js required) for Windows, Linux, and macOS using the `pkg` library:

1. Install `pkg` globally:
    ```sh
    npm install -g pkg
    ```

2. Build executables for all platforms:
    ```sh
    pkg findDuplicatesInFolder.js --targets node18-macos-x64,node18-linux-x64,node18-win-x64
    ```

3. (Optional) Make the Linux and macOS binaries executable:
    ```sh
    chmod +x ./findDuplicatesInFolder-linux
    chmod +x ./findDuplicatesInFolder-macos
    ```

4. Run the executable (example for Linux):
    ```sh
    ./findDuplicatesInFolder-linux /path/to/folder
    ```

Replace `/path/to/folder` with the directory you want to scan for duplicate DICOM files.

## 🛠️ Notes
- The script identifies DICOM files by checking their headers, not just their file extensions.
- It uses the `dicom-parser` library to extract pixel data and patient information.
- Ensure that the folders you provide contain valid DICOM files for accurate results.

---

## 📜 License
This project is licensed under the MIT License.