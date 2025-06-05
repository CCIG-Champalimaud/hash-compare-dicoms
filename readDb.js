const { open } = require('lmdb')
const path = require('path')

const db = open({
  path: path.resolve(__dirname, 'dicom_db'),
  readOnly: true
})
const limit = 50 // Limit the number of entries to display

let i = 0
for (const { key, value } of db.getRange()) {
    i++
    console.log('key:', key)
    console.log('val:', value)
    if(i>limit) break
}