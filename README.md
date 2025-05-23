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

## 🛠️ Notes
- The script identifies DICOM files by checking their headers, not just their file extensions.
- It uses the `dicom-parser` library to extract pixel data and patient information.
- Ensure that the folders you provide contain valid DICOM files for accurate results.

---

## 📜 License
This project is licensed under the MIT License.