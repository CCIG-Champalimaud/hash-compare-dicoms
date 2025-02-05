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