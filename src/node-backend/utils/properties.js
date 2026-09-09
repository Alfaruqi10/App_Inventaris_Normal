import fs from 'fs';
import path from 'path';

const filePath = path.resolve('properties.json');

/**
 * Membaca properti dari file JSON lokal secara aman.
 */
function readProperties() {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content || '{}');
    }
  } catch (err) {
    console.error('[PropertiesManager ERROR] Failed to read properties.json:', err.message);
  }
  return {};
}

/**
 * Menyimpan properti ke file JSON lokal secara aman.
 */
function writeProperties(props) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(props, null, 2), 'utf8');
  } catch (err) {
    console.error('[PropertiesManager ERROR] Failed to write properties.json:', err.message);
  }
}

export const propertiesService = {
  /**
   * Mengambil satu properti.
   */
  getProperty(key) {
    const props = readProperties();
    return props[key] !== undefined ? String(props[key]) : null;
  },

  /**
   * Menyimpan properti.
   */
  setProperty(key, value) {
    const props = readProperties();
    props[key] = value;
    writeProperties(props);
  },

  /**
   * Mengambil seluruh properti.
   */
  getProperties() {
    return readProperties();
  }
};

export default propertiesService;
