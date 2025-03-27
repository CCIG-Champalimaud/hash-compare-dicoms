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

### 2️⃣ Run the script
Navigate to the project folder and run:

```sh
node run.js /path/to/folder1 /path/to/folder2
```


---

## 📊 Example Output

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

## 🛠️ Notes
- The script identifies DICOM files by checking their headers, not just their file extensions.
- It uses the `dicom-parser` library to extract pixel data and patient information.
- Ensure that the folders you provide contain valid DICOM files for accurate results.

---

## 📜 License
This project is licensed under the MIT License.